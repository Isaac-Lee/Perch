use std::io::Read;

fn main() {
    std::panic::set_hook(Box::new(|_| {}));
    let _ = std::panic::catch_unwind(|| {
        if std::env::args().nth(1).as_deref() != Some("hermes") {
            return;
        }
        let mut buf = String::new();
        if std::io::stdin().read_to_string(&mut buf).is_err() {
            return;
        }
        perch_hook::run(&buf, &perch_hook::home(), perch_hook::now());
    });
    std::process::exit(0);
}
