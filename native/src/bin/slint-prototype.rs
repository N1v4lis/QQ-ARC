use qqaf_native::{
    gpu,
    storage::{AccountStore, default_data_root},
};
use std::{cell::RefCell, rc::Rc};
slint::include_modules!();

fn main() -> Result<(), Box<dyn std::error::Error>> {
    if std::env::args().any(|arg| arg == "--probe-gpu") {
        let gpu = gpu::probe();
        println!("hardware_gpu={}\n{}", gpu.available, gpu.description);
        return Ok(());
    }
    let store = Rc::new(RefCell::new(AccountStore::open(
        &default_data_root(),
        "local-settings",
    )?));
    let app = AppWindow::new()?;
    app.set_minecraft(store.borrow().preference("minecraft")?.as_deref() == Some("true"));
    // Never claim the unfinished renderer is usable, even when a GPU is present.
    app.set_winefox_available(false);
    app.set_winefox_enabled(false);
    {
        let store = store.clone();
        let weak = app.as_weak();
        app.on_change_theme(move |enabled| {
            if let Err(error) = store
                .borrow_mut()
                .set_preference("minecraft", if enabled { "true" } else { "false" })
            {
                if let Some(app) = weak.upgrade() {
                    app.set_operation_status(format!("保存失败：{error}").into());
                }
            }
        });
    }
    let weak = app.as_weak();
    app.on_minimize(move || {
        if let Some(app) = weak.upgrade() {
            app.window().set_minimized(true);
        }
    });
    let weak = app.as_weak();
    app.on_maximize(move || {
        if let Some(app) = weak.upgrade() {
            app.window().set_maximized(!app.window().is_maximized());
        }
    });
    let weak = app.as_weak();
    app.on_close(move || {
        if let Some(app) = weak.upgrade() {
            let _ = app.hide();
        }
    });
    let weak = app.as_weak();
    app.on_move_window(move |dx, dy| {
        if let Some(app) = weak.upgrade() {
            if !app.window().is_maximized() {
                let position = app.window().position();
                let scale = app.window().scale_factor();
                app.window().set_position(slint::PhysicalPosition::new(
                    position.x + (dx * scale).round() as i32,
                    position.y + (dy * scale).round() as i32,
                ));
            }
        }
    });
    let weak = app.as_weak();
    std::thread::spawn(move || {
        let result = std::panic::catch_unwind(gpu::probe).unwrap_or(gpu::GpuStatus {
            available: false,
            description: "图形设备检测失败，酒狐无法启用".into(),
        });
        let text = if result.available {
            format!("硬件 GPU：{}；酒狐原生 3D 模块待迁移", result.description)
        } else {
            result.description
        };
        let _ = weak.upgrade_in_event_loop(move |app| app.set_gpu_status(text.into()));
    });
    // A bounded smoke run creates and renders a real window, then exits.
    let smoke = slint::Timer::default();
    if std::env::args().any(|arg| arg == "--smoke-test") {
        let weak = app.as_weak();
        smoke.start(
            slint::TimerMode::SingleShot,
            std::time::Duration::from_secs(3),
            move || {
                if let Some(app) = weak.upgrade() {
                    let _ = app.hide();
                }
            },
        );
    }
    app.run()?;
    Ok(())
}
