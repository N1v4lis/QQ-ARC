//! Transactional installation of an already verified official archive.
//! Supports both full (includes node.exe) and lite (requires system Node.js) variants.
//! Installation requires a user action; no background updater is registered.
use std::{
    collections::HashSet,
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};

pub fn default_directory() -> Result<PathBuf, String> {
    Ok(std::env::current_exe()
        .map_err(|_| "无法定位程序目录")?
        .parent()
        .ok_or("无法定位程序目录")?
        .join("Snowluma"))
}
pub fn target_directory(value: Option<&str>) -> Result<PathBuf, String> {
    let path = value
        .filter(|v| !v.trim().is_empty())
        .map(PathBuf::from)
        .map(Ok)
        .unwrap_or_else(default_directory)?;
    if !path.is_absolute()
        || path
            .components()
            .any(|p| matches!(p, Component::ParentDir | Component::CurDir))
    {
        return Err("安装目录必须是完整绝对路径，不能包含上级目录跳转".into());
    }
    let name = path.file_name().ok_or("不能安装到磁盘根目录")?;
    let parent = fs::canonicalize(path.parent().ok_or("安装目录无效")?)
        .map_err(|_| "安装目录的父文件夹不存在，请选择已有文件夹下的位置")?;
    let target = parent.join(name);
    if target.exists() {
        reject_link(&target)?;
        if !target.is_dir() {
            return Err("安装位置不是文件夹".into());
        }
        let empty = fs::read_dir(&target)
            .map_err(|_| "无法读取安装目录")?
            .next()
            .is_none();
        let package: serde_json::Value = fs::read(target.join("package.json"))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        let marker: serde_json::Value = fs::read(target.join("qqaf-component.json"))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        // Accept both full (has node.exe) and lite (no node.exe) installs.
        let has_index = target.join("index.mjs").is_file();
        if !empty
            && (!has_index
                || (package["name"] != "@snowluma/runtime" && marker["component"] != "SnowLuma"))
        {
            return Err("所选目录非空且不是 SnowLuma，拒绝覆盖其他程序或用户文件".into());
        }
    }
    Ok(target)
}
fn reject_link(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| "无法读取文件属性")?;
    if metadata.file_type().is_symlink() {
        return Err("安装路径包含符号链接，不能安全更新".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err("安装路径包含重解析点，不能安全更新".into());
        }
    }
    Ok(())
}
fn safe_entry(name: &str) -> Result<PathBuf, String> {
    if name.contains('\\') || name.contains(':') {
        return Err("发行包路径无效".into());
    }
    let path = PathBuf::from(name);
    if path.is_absolute()
        || path
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err("发行包包含越界路径".into());
    }
    for part in path.components() {
        let value = part.as_os_str().to_string_lossy();
        let base = value.split('.').next().unwrap_or("").to_ascii_uppercase();
        if value.ends_with([' ', '.'])
            || value.contains(['<', '>', '"', '|', '?', '*'])
            || matches!(base.as_str(), "CON" | "PRN" | "AUX" | "NUL")
            || (base.len() == 4
                && (base.starts_with("COM") || base.starts_with("LPT"))
                && base.as_bytes()[3].is_ascii_digit())
        {
            return Err("发行包包含无效 Windows 文件名".into());
        }
    }
    Ok(path)
}
fn mutable(path: &Path) -> bool {
    path.components().next().is_some_and(|p| {
        matches!(
            p.as_os_str()
                .to_string_lossy()
                .to_ascii_lowercase()
                .as_str(),
            "config" | "data" | "logs" | "cache" | "accounts" | "userdata"
        )
    })
}
fn copy_existing(
    source: &Path,
    destination: &Path,
    relative: &Path,
    prior_files: &HashSet<String>,
    cancelled: &impl Fn() -> bool,
) -> Result<(), String> {
    if cancelled() {
        return Err("下载已取消".into());
    }
    reject_link(source)?;
    if source.is_dir() {
        fs::create_dir_all(destination).map_err(|_| "无法保留已有组件目录")?;
        for entry in fs::read_dir(source).map_err(|_| "读取原组件目录失败")? {
            let entry = entry.map_err(|_| "读取原组件文件失败")?;
            copy_existing(
                &entry.path(),
                &destination.join(entry.file_name()),
                &relative.join(entry.file_name()),
                prior_files,
                cancelled,
            )?;
        }
    } else if mutable(relative)
        || (!destination.exists()
            && !prior_files.contains(&relative.to_string_lossy().replace('\\', "/")))
    {
        fs::copy(source, destination).map_err(|_| "保留原配置和用户文件失败，原目录未替换")?;
    }
    Ok(())
}
pub struct Installed {
    pub directory: PathBuf,
    pub backup: Option<PathBuf>,
}
pub fn install(
    archive: &Path,
    target: &Path,
    tag: &str,
    digest: &str,
    variant: &str,
    cancelled: impl Fn() -> bool,
) -> Result<Installed, String> {
    let parent = target.parent().ok_or("安装目录无效")?;
    let stage = parent.join(format!(".qqaf-snowluma-stage-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&stage).map_err(|_| "安装目录无法写入，请更改安装位置或检查磁盘空间")?;
    let preparation = (|| {
        let file = fs::File::open(archive).map_err(|_| "无法打开已下载发行包")?;
        let mut zip = zip::ZipArchive::new(file).map_err(|_| "发行包 ZIP 格式无效")?;
        if zip.len() > 10000 {
            return Err("发行包文件数量超限".into());
        }
        let mut total = 0u64;
        let mut paths = HashSet::new();
        let mut entries = Vec::new();
        for index in 0..zip.len() {
            let entry = zip.by_index(index).map_err(|_| "读取发行包目录失败")?;
            let path = safe_entry(entry.name().trim_end_matches('/'))?;
            if entry
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
            {
                return Err("发行包含符号链接".into());
            }
            total = total.checked_add(entry.size()).ok_or("发行包大小超限")?;
            if total > 2 * 1024 * 1024 * 1024 || entry.size() > 512 * 1024 * 1024 {
                return Err("发行包解压大小超限".into());
            }
            if !paths.insert(path.to_string_lossy().to_ascii_lowercase()) {
                return Err("发行包包含重复路径".into());
            }
            entries.push((index, path, entry.is_dir()));
        }
        let root = if paths.contains("index.mjs") {
            PathBuf::new()
        } else {
            let candidates: Vec<_> = entries
                .iter()
                .filter(|(_, p, _)| p.file_name().is_some_and(|n| n == "index.mjs"))
                .filter_map(|(_, p, _)| p.parent().map(Path::to_path_buf))
                .collect();
            if candidates.len() != 1 || candidates[0].components().count() != 1 {
                return Err("发行包目录结构不受支持".into());
            }
            candidates[0].clone()
        };
        let mut inventory = Vec::new();
        let mut buffer = [0u8; 65536];
        for (index, path, is_dir) in entries {
            if cancelled() {
                return Err("下载已取消".into());
            }
            let relative = path
                .strip_prefix(&root)
                .map_err(|_| "发行包包含主目录以外文件")?;
            if relative.as_os_str().is_empty() {
                continue;
            }
            let output = stage.join(relative);
            if is_dir {
                fs::create_dir_all(&output).map_err(|_| "解压目录创建失败")?;
                continue;
            }
            fs::create_dir_all(output.parent().unwrap()).map_err(|_| "解压目录创建失败")?;
            let mut input = zip.by_index(index).map_err(|_| "解压发行包失败")?;
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(output)
                .map_err(|_| "创建解压文件失败")?;
            loop {
                if cancelled() {
                    return Err("下载已取消".into());
                }
                let n = input.read(&mut buffer).map_err(|_| "发行包内容损坏")?;
                if n == 0 {
                    break;
                }
                file.write_all(&buffer[..n])
                    .map_err(|_| "解压写入失败，检查磁盘空间")?;
            }
            inventory.push(relative.to_string_lossy().replace('\\', "/"));
        }
        // Full variant requires node.exe; lite variant only requires index.mjs + native addon.
        let required: &[&str] = if variant == "lite" {
            &[
                "index.mjs",
                "native/snowluma-win32-x64.node",
                "EULA.md",
                "PRIVACY.md",
            ]
        } else {
            &[
                "node.exe",
                "index.mjs",
                "native/snowluma-win32-x64.node",
                "EULA.md",
                "PRIVACY.md",
            ]
        };
        for name in required {
            if !stage.join(name).is_file()
                && !(name == &"native/snowluma-win32-x64.node"
                    && stage.join("native/snowluma-win32-x64.dll").is_file())
            {
                return Err(format!("发行包缺少 {name}，原组件未替换"));
            }
        }
        if target.exists() {
            let prior: serde_json::Value = fs::read(target.join("qqaf-component.json"))
                .ok()
                .and_then(|b| serde_json::from_slice(&b).ok())
                .unwrap_or_default();
            let prior_files: HashSet<_> = prior["files"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect();
            copy_existing(target, &stage, Path::new(""), &prior_files, &cancelled)?;
        }
        let marker = serde_json::json!({"component":"SnowLuma","version":tag,"variant":variant,"sha256":digest,"repository":"SnowLuma/SnowLuma","files":inventory});
        fs::write(
            stage.join("qqaf-component.json"),
            serde_json::to_vec_pretty(&marker).unwrap(),
        )
        .map_err(|_| "安装记录写入失败")?;
        Ok::<(), String>(())
    })();
    if let Err(e) = preparation {
        let _ = fs::remove_dir_all(&stage);
        return Err(e);
    }
    if cancelled() {
        let _ = fs::remove_dir_all(&stage);
        return Err("下载已取消".into());
    }
    // Revalidate ownership after preparing files. The old directory is retained
    // as a backup; an unsuccessful swap restores it without recursive deletion.
    if let Err(e) = target_directory(target.to_str()) {
        let _ = fs::remove_dir_all(&stage);
        return Err(e);
    }
    let backup = if target.exists() {
        let backup = parent.join(format!("Snowluma-backup-{}", uuid::Uuid::new_v4()));
        if fs::rename(target, &backup).is_err() {
            let _ = fs::remove_dir_all(&stage);
            return Err("原组件可能仍在运行或被占用，请停止组件后重试；原目录已保留".into());
        }
        Some(backup)
    } else {
        None
    };
    if let Err(_) = fs::rename(&stage, target) {
        if let Some(backup) = &backup {
            if fs::rename(backup, target).is_err() {
                return Err(format!(
                    "安装失败且自动恢复未完成，原组件完整保留于 {}",
                    backup.display()
                ));
            }
        }
        let _ = fs::remove_dir_all(&stage);
        return Err("安装失败，原组件已恢复".into());
    }
    Ok(Installed {
        directory: target.into(),
        backup,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    use zip::write::SimpleFileOptions;
    fn root() -> PathBuf {
        let p = std::env::temp_dir().join(format!("qqaf-snow-install-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&p).unwrap();
        p
    }
    fn archive(root: &Path, extra: &[(&str, &str)]) -> PathBuf {
        let path = root.join("fixture.zip");
        let mut zip = zip::ZipWriter::new(fs::File::create(&path).unwrap());
        for (name, text) in [
            ("node.exe", "fake node; never execute"),
            (
                "package.json",
                r#"{"name":"@snowluma/runtime","version":"1-fixture"}"#,
            ),
            ("index.mjs", "new program fixture"),
            ("native/snowluma-win32-x64.node", "fixture native"),
            ("native/snowluma-win32-x64.dll", "fixture native"),
            ("EULA.md", "fixture terms"),
            ("PRIVACY.md", "fixture terms"),
        ]
        .into_iter()
        .chain(extra.iter().copied())
        {
            zip.start_file(
                name,
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored),
            )
            .unwrap();
            zip.write_all(text.as_bytes()).unwrap();
        }
        zip.finish().unwrap();
        path
    }
    #[test]
    fn install_replaces_program_preserves_user_files_and_keeps_backup() {
        let root = root();
        let target = root.join("Snowluma");
        fs::create_dir_all(target.join("config")).unwrap();
        fs::write(target.join("node.exe"), "old program").unwrap();
        fs::write(target.join("index.mjs"), "old source").unwrap();
        fs::write(
            target.join("package.json"),
            r#"{"name":"@snowluma/runtime","version":"old-fixture"}"#,
        )
        .unwrap();
        fs::write(
            target.join("config/runtime.json"),
            "private fixture configuration",
        )
        .unwrap();
        fs::write(target.join("notes.txt"), "user fixture").unwrap();
        let zip = archive(
            &root,
            &[
                ("config/runtime.json", "new default"),
                ("LICENSE", "fixture license"),
            ],
        );
        let installed = install(&zip, &target, "v1-fixture", "fixture-digest", "full", || false).unwrap();
        assert_eq!(
            fs::read_to_string(target.join("index.mjs")).unwrap(),
            "new program fixture"
        );
        assert_eq!(
            fs::read_to_string(target.join("config/runtime.json")).unwrap(),
            "private fixture configuration"
        );
        assert_eq!(
            fs::read_to_string(target.join("notes.txt")).unwrap(),
            "user fixture"
        );
        assert_eq!(
            fs::read_to_string(target.join("LICENSE")).unwrap(),
            "fixture license"
        );
        assert_eq!(
            fs::read_to_string(installed.backup.unwrap().join("index.mjs")).unwrap(),
            "old source"
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn invalid_archives_and_cancelled_installs_never_change_the_target() {
        for extra in [
            vec![("../outside.txt", "escape")],
            vec![("CON.txt", "device")],
            vec![("INDEX.MJS", "collision")],
        ] {
            let root = root();
            let target = root.join("Snowluma");
            fs::create_dir_all(&target).unwrap();
            fs::write(target.join("node.exe"), "old").unwrap();
            fs::write(target.join("index.mjs"), "old source").unwrap();
            fs::write(
                target.join("package.json"),
                r#"{"name":"@snowluma/runtime","version":"old-fixture"}"#,
            )
            .unwrap();
            let zip = archive(&root, &extra);
            assert!(install(&zip, &target, "v-fixture", "fixture", "full", || false).is_err());
            assert_eq!(
                fs::read_to_string(target.join("index.mjs")).unwrap(),
                "old source"
            );
            assert!(!root.join("outside.txt").exists());
            assert!(install(&zip, &target, "v-fixture", "fixture", "full", || true).is_err());
            assert_eq!(
                fs::read_to_string(target.join("index.mjs")).unwrap(),
                "old source"
            );
            fs::remove_dir_all(root).unwrap();
        }
    }
    #[test]
    fn directory_selection_does_not_overwrite_unrelated_files() {
        let root = root();
        let target = root.join("other-app");
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("important.txt"), "preserve").unwrap();
        assert!(target_directory(target.to_str()).is_err());
        assert!(target_directory(Some("C:/")).is_err());
        assert!(target_directory(Some("relative/Snowluma")).is_err());
        assert_eq!(
            fs::read_to_string(target.join("important.txt")).unwrap(),
            "preserve"
        );
        fs::remove_dir_all(root).unwrap();
    }
}
