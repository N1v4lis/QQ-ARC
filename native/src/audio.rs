use std::sync::Mutex;
static PLAYING: Mutex<()> = Mutex::new(());
#[cfg(windows)]
#[link(name = "winmm")]
unsafe extern "system" {
    fn PlaySoundW(sound: *const u16, module: *mut core::ffi::c_void, flags: u32) -> i32;
}
pub fn play(name: &str, volume: f64) -> Result<(), String> {
    if ![
        "menu",
        "pistonin",
        "pistonout",
        "bow",
        "pop",
        "hit1",
        "hit2",
        "hit3",
        "beaconactivate",
        "beacondeactivate",
    ]
    .contains(&name)
        || !volume.is_finite()
        || !(0.0..=1.0).contains(&volume)
    {
        return Err("音效参数无效".into());
    }
    if volume == 0.0 {
        return Ok(());
    }
    let Ok(_guard) = PLAYING.try_lock() else {
        return Ok(());
    };
    let root = std::env::current_exe()
        .map_err(|_| "程序目录不可用")?
        .parent()
        .ok_or("程序目录不可用")?
        .to_path_buf();
    let mut bytes = std::fs::read(
        root.join("data/flutter_assets/assets/mc/sfx")
            .join(format!("{name}.wav")),
    )
    .map_err(|_| "音效资源缺失")?;
    if bytes.len() < 44 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("音效文件无效".into());
    }
    let mut offset = 12;
    let mut valid = false;
    while offset + 8 <= bytes.len() {
        let size = u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap()) as usize;
        let start = offset + 8;
        let end = start
            .checked_add(size)
            .filter(|v| *v <= bytes.len())
            .ok_or("音效文件无效")?;
        if &bytes[offset..offset + 4] == b"fmt " {
            if size < 16 {
                return Err("音效格式无效".into());
            }
            valid = u16::from_le_bytes(bytes[start..start + 2].try_into().unwrap()) == 1
                && u16::from_le_bytes(bytes[start + 14..start + 16].try_into().unwrap()) == 16;
        }
        if &bytes[offset..offset + 4] == b"data" {
            if !valid {
                return Err("音效需要 16 位 PCM".into());
            }
            for sample in bytes[start..end].chunks_exact_mut(2) {
                let original = i16::from_le_bytes(sample.try_into().unwrap());
                sample.copy_from_slice(&((original as f64 * volume).round() as i16).to_le_bytes());
            }
        }
        offset = end + (size % 2);
    }
    #[cfg(windows)]
    {
        // SND_MEMORY, synchronous: the buffer remains alive throughout playback.
        // SND_NODEFAULT prevents a system beep on missing/invalid audio.
        let result = unsafe { PlaySoundW(bytes.as_ptr().cast(), core::ptr::null_mut(), 4 | 2) };
        if result == 0 {
            return Err("音效播放失败".into());
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err("此音频后端仅适用于 Windows".into())
    }
}
