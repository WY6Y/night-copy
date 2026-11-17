//! Desktop entry point. The app itself is in lib.rs, shared with Android.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    night_copy_lib::run()
}
