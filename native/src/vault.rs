//! Windows credentials are encrypted for the current Windows user with DPAPI.
//! This module never invokes a shell or includes plaintext in diagnostics.
#[cfg(windows)]
mod platform {
    #[repr(C)]
    struct Blob {
        size: u32,
        data: *mut u8,
    }
    #[link(name = "crypt32")]
    unsafe extern "system" {
        fn CryptProtectData(
            input: *const Blob,
            description: *const u16,
            entropy: *const Blob,
            reserved: *mut core::ffi::c_void,
            prompt: *mut core::ffi::c_void,
            flags: u32,
            output: *mut Blob,
        ) -> i32;
        fn CryptUnprotectData(
            input: *const Blob,
            description: *mut *mut u16,
            entropy: *const Blob,
            reserved: *mut core::ffi::c_void,
            prompt: *mut core::ffi::c_void,
            flags: u32,
            output: *mut Blob,
        ) -> i32;
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn LocalFree(memory: *mut core::ffi::c_void) -> *mut core::ffi::c_void;
    }
    pub fn transform(bytes: &[u8], protect: bool) -> Result<Vec<u8>, String> {
        let input = Blob {
            size: u32::try_from(bytes.len()).map_err(|_| "凭据过长")?,
            data: bytes.as_ptr().cast_mut(),
        };
        let mut output = Blob {
            size: 0,
            data: core::ptr::null_mut(),
        };
        // SAFETY: DPAPI copies the immutable input and allocates output with LocalAlloc.
        // UI is prohibited by flag 1, and output is freed exactly once after copying.
        unsafe {
            let ok = if protect {
                CryptProtectData(
                    &input,
                    core::ptr::null(),
                    core::ptr::null(),
                    core::ptr::null_mut(),
                    core::ptr::null_mut(),
                    1,
                    &mut output,
                )
            } else {
                CryptUnprotectData(
                    &input,
                    core::ptr::null_mut(),
                    core::ptr::null(),
                    core::ptr::null_mut(),
                    core::ptr::null_mut(),
                    1,
                    &mut output,
                )
            };
            if ok == 0 {
                return Err("Windows 凭据保护失败".into());
            }
            let result = core::slice::from_raw_parts(output.data, output.size as usize).to_vec();
            LocalFree(output.data.cast());
            Ok(result)
        }
    }
}
pub fn protect(value: &str) -> Result<String, String> {
    #[cfg(windows)]
    {
        Ok(platform::transform(value.as_bytes(), true)?
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect())
    }
    #[cfg(not(windows))]
    {
        let _ = value;
        Err("当前平台尚未接入系统凭据库".into())
    }
}
pub fn reveal(value: &str) -> Result<String, String> {
    #[cfg(windows)]
    {
        if value.len() % 2 != 0 || !value.is_ascii() {
            return Err("加密凭据无效".into());
        }
        let bytes: Result<Vec<_>, _> = (0..value.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&value[i..i + 2], 16))
            .collect();
        String::from_utf8(platform::transform(
            &bytes.map_err(|_| "加密凭据无效")?,
            false,
        )?)
        .map_err(|_| "凭据编码无效".into())
    }
    #[cfg(not(windows))]
    {
        let _ = value;
        Err("当前平台尚未接入系统凭据库".into())
    }
}
