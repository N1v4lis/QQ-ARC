fn main() {
    #[cfg(feature = "slint-prototype")]
    slint_build::compile("ui/app.slint").expect("compile optional Slint experiment");
}
