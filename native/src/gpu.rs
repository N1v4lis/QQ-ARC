#[derive(Clone, Debug, Default)]
pub struct GpuStatus {
    pub available: bool,
    pub description: String,
}

// A display adapter name is insufficient: require an actual hardware device.
pub fn probe() -> GpuStatus {
    let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::default());
    for adapter in instance.enumerate_adapters(wgpu::Backends::all()) {
        let info = adapter.get_info();
        if !hardware_type(info.device_type) {
            continue;
        }
        let descriptor = wgpu::DeviceDescriptor {
            label: Some("QQAF hardware capability probe"),
            ..Default::default()
        };
        if let Ok((device, _queue)) = pollster::block_on(adapter.request_device(&descriptor)) {
            device.destroy();
            return GpuStatus {
                available: true,
                description: format!("{} · {:?}", info.name, info.backend),
            };
        }
    }
    GpuStatus {
        available: false,
        description: "未检测到可用硬件 GPU，酒狐无法启用".into(),
    }
}

fn hardware_type(kind: wgpu::DeviceType) -> bool {
    matches!(
        kind,
        wgpu::DeviceType::DiscreteGpu | wgpu::DeviceType::IntegratedGpu
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn software_and_unidentified_adapters_do_not_unlock_pet() {
        assert!(hardware_type(wgpu::DeviceType::IntegratedGpu));
        assert!(hardware_type(wgpu::DeviceType::DiscreteGpu));
        assert!(!hardware_type(wgpu::DeviceType::Cpu));
        assert!(!hardware_type(wgpu::DeviceType::Other));
        assert!(!hardware_type(wgpu::DeviceType::VirtualGpu));
    }
}
