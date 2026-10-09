# QQAF 原生主题包制作规范 v1

适用 RS0.2.0 Flutter + Rust。主题包是 UTF-8 JSON，后缀 `.qqtheme`，不是可执行插件；不接受脚本、HTML、任意文件解压或账号设置。

```json
{"format":"qqaf-theme","version":1,"settings":{"skin":"default","theme":"dark","accent":"4176e6","fontFamily":"Segoe UI","fontSize":13,"background":false,"opacity":0.55}}
```

字段：`skin` 为 default/minecraft；`theme` 为 light/dark/auto；`accent` 为六位十六进制色；字体名称不超过120字节、字号11–18；mcFont/background/sound 为布尔值；opacity/masterVolume/clickVolume/toggleVolume/sliderVolume 为0–1；wallpaper 为1–3。clickSound 支持 hit/menu/pop/none，toggleSound 支持 piston/beacon/none，sliderSound 支持 bow/pop/none。

可选 `customBackground` 是 PNG 字节数组，文件最多1MiB，尺寸不大于8192×8192，总像素最多1600万。可在导出界面指定背景文件，由程序打包，无需手工写数组。设置 background=true 启用自定义背景；导入后移除自定义背景可恢复预置背景。图片实际解码失败时界面留空，不执行文件或脚本。

整个主题包最多8MiB。缺省字段保留当前偏好，未知字段直接拒绝；API Key、提供商、人设、autoStart、closeAction 等都不属于主题包。导出仅白名单视觉字段，导入合并视觉字段并保持酒狐禁用。自定义配色在 Minecraft 主题中仍不生效；默认主题使用 accent。

作者保留图像/字体的授权说明。v1 使用程序随附的默认/MC控件及字体，不包含自定义字体/着色器/第三方布局；这些扩展需要后续格式升级，不能把字段改名当成已支持。后续 UI 字段或行为改变时必须同步此文档和验证器，破坏性变化提升 format version。
