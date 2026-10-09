#include "flutter_window.h"

#include <optional>
#include <shellapi.h>
#include <shobjidl.h>
#include <flutter/standard_method_codec.h>
#include "resource.h"

#include "flutter/generated_plugin_registrant.h"

FlutterWindow::FlutterWindow(const flutter::DartProject& project)
    : project_(project) {}

FlutterWindow::~FlutterWindow() {}

bool FlutterWindow::OnCreate() {
  if (!Win32Window::OnCreate()) {
    return false;
  }

  RECT frame = GetClientArea();

  // The size here must match the window dimensions to avoid unnecessary surface
  // creation / destruction in the startup path.
  flutter_controller_ = std::make_unique<flutter::FlutterViewController>(
      frame.right - frame.left, frame.bottom - frame.top, project_);
  // Ensure that basic setup of the controller was successful.
  if (!flutter_controller_->engine() || !flutter_controller_->view()) {
    return false;
  }
  RegisterPlugins(flutter_controller_->engine());
  SetChildContent(flutter_controller_->view()->GetNativeWindow());
  desktop_channel_ = std::make_unique<flutter::MethodChannel<flutter::EncodableValue>>(
      flutter_controller_->engine()->messenger(), "qqaf/desktop",
      &flutter::StandardMethodCodec::GetInstance());
  desktop_channel_->SetMethodCallHandler([this](const auto& call, auto result) {
    if (call.method_name() == "setTray") {
      const auto* value = call.arguments() ? std::get_if<bool>(call.arguments()) : nullptr;
      if (value && SetTrayEnabled(*value)) result->Success();
      else result->Error("tray", "Windows tray update failed");
    } else if (call.method_name() == "setStartup") {
      const auto* enabled = call.arguments() ? std::get_if<bool>(call.arguments()) : nullptr;
      HKEY key = nullptr;
      if (!enabled || RegCreateKeyExW(HKEY_CURRENT_USER,
          L"Software\\Microsoft\\Windows\\CurrentVersion\\Run", 0, nullptr, 0,
          KEY_SET_VALUE, nullptr, &key, nullptr) != ERROR_SUCCESS) {
        result->Error("startup", "Startup registry unavailable"); return;
      }
      LSTATUS status;
      if (*enabled) {
        wchar_t executable[32768] = {};
        const DWORD length = GetModuleFileNameW(nullptr, executable, 32768);
        if (length == 0 || length >= 32768) { RegCloseKey(key); result->Error("startup", "Executable path unavailable"); return; }
        const std::wstring command = L"\"" + std::wstring(executable) + L"\"";
        status = RegSetValueExW(key, L"QQARCFOX Experimental", 0, REG_SZ,
            reinterpret_cast<const BYTE*>(command.c_str()),
            static_cast<DWORD>((command.size() + 1) * sizeof(wchar_t)));
      } else { status = RegDeleteValueW(key, L"QQARCFOX Experimental"); }
      RegCloseKey(key);
      if (status == ERROR_SUCCESS || (!*enabled && status == ERROR_FILE_NOT_FOUND)) result->Success();
      else result->Error("startup", "Startup registry update failed");
    } else if (call.method_name() == "chooseDirectory") {
      IFileOpenDialog* dialog = nullptr;
      if (FAILED(CoCreateInstance(__uuidof(FileOpenDialog), nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&dialog)))) {
        result->Error("directory", "Directory picker unavailable"); return;
      }
      DWORD options = 0; dialog->GetOptions(&options);
      dialog->SetOptions(options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM);
      dialog->SetTitle(L"选择 SnowLuma 安装目录的父文件夹");
      const HRESULT shown = dialog->Show(GetHandle());
      if (shown == HRESULT_FROM_WIN32(ERROR_CANCELLED)) { dialog->Release(); result->Success(); return; }
      IShellItem* item = nullptr; PWSTR path = nullptr;
      if (FAILED(shown) || FAILED(dialog->GetResult(&item)) || FAILED(item->GetDisplayName(SIGDN_FILESYSPATH, &path))) {
        if (item) item->Release(); dialog->Release(); result->Error("directory", "Directory selection failed"); return;
      }
      const int length = WideCharToMultiByte(CP_UTF8, 0, path, -1, nullptr, 0, nullptr, nullptr);
      std::string utf8(length, '\0');
      WideCharToMultiByte(CP_UTF8, 0, path, -1, utf8.data(), length, nullptr, nullptr);
      if (!utf8.empty()) utf8.pop_back();
      CoTaskMemFree(path); item->Release(); dialog->Release();
      result->Success(flutter::EncodableValue(utf8));
    } else if (call.method_name() == "openDirectory") {
      const auto* value = call.arguments() ? std::get_if<std::string>(call.arguments()) : nullptr;
      if (!value || value->empty() || value->size() > 32760) { result->Error("directory", "Directory path invalid"); return; }
      const int length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value->data(), static_cast<int>(value->size()), nullptr, 0);
      if (!length) { result->Error("directory", "Directory encoding invalid"); return; }
      std::wstring path(length, L'\0');
      MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value->data(), static_cast<int>(value->size()), path.data(), length);
      const DWORD attributes = GetFileAttributesW(path.c_str());
      if (attributes == INVALID_FILE_ATTRIBUTES || !(attributes & FILE_ATTRIBUTE_DIRECTORY)) { result->Error("directory", "Directory does not exist"); return; }
      if (reinterpret_cast<INT_PTR>(ShellExecuteW(GetHandle(), L"open", path.c_str(), nullptr, nullptr, SW_SHOWNORMAL)) > 32) result->Success();
      else result->Error("directory", "Directory launch failed");
    } else if (call.method_name() == "openUrl") {
      const auto* value = call.arguments() ? std::get_if<std::string>(call.arguments()) : nullptr;
      if (!value || value->size() > 4096 || (value->rfind("https://",0) != 0 && value->rfind("http://",0) != 0)) {
        result->Error("url", "Only HTTP links are supported"); return;
      }
      const int length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value->data(), static_cast<int>(value->size()), nullptr, 0);
      if (!length) { result->Error("url", "URL encoding invalid"); return; }
      std::wstring url(length, L'\0');
      MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value->data(), static_cast<int>(value->size()), url.data(), length);
      if (reinterpret_cast<INT_PTR>(ShellExecuteW(GetHandle(), L"open", url.c_str(), nullptr, nullptr, SW_SHOWNORMAL)) > 32) result->Success();
      else result->Error("url", "Browser launch failed");
    } else { result->NotImplemented(); }
  });

  flutter_controller_->engine()->SetNextFrameCallback([&]() {
    this->Show();
  });

  // Flutter can complete the first frame before the "show window" callback is
  // registered. The following call ensures a frame is pending to ensure the
  // window is shown. It is a no-op if the first frame hasn't completed yet.
  flutter_controller_->ForceRedraw();

  return true;
}

void FlutterWindow::OnDestroy() {
  SetTrayEnabled(false);
  desktop_channel_ = nullptr;
  if (flutter_controller_) {
    flutter_controller_ = nullptr;
  }

  Win32Window::OnDestroy();
}
bool FlutterWindow::SetTrayEnabled(bool enabled) {
  NOTIFYICONDATAW icon = {};
  icon.cbSize = sizeof(icon); icon.hWnd = GetHandle(); icon.uID = 1;
  icon.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP; icon.uCallbackMessage = WM_APP + 10;
  icon.hIcon = LoadIconW(GetModuleHandleW(nullptr), MAKEINTRESOURCEW(IDI_APP_ICON));
  wcscpy_s(icon.szTip, L"QQ Agent ARCFØX · 实验版");
  if (!enabled) { if (tray_enabled_) Shell_NotifyIconW(NIM_DELETE, &icon); tray_enabled_ = false; return true; }
  if (!Shell_NotifyIconW(tray_enabled_ ? NIM_MODIFY : NIM_ADD, &icon)) {
    if (!Shell_NotifyIconW(NIM_ADD, &icon)) return false;
  }
  tray_enabled_ = true; return true;
}

LRESULT
FlutterWindow::MessageHandler(HWND hwnd, UINT const message,
                              WPARAM const wparam,
                              LPARAM const lparam) noexcept {
  if (message == WM_APP + 10) {
    if (lparam == WM_LBUTTONUP || lparam == WM_LBUTTONDBLCLK) {
      ShowWindow(hwnd, SW_RESTORE); SetForegroundWindow(hwnd);
    } else if (lparam == WM_RBUTTONUP) {
      HMENU menu = CreatePopupMenu();
      AppendMenuW(menu, MF_STRING, 1, L"显示 QQAF");
      AppendMenuW(menu, MF_STRING, 2, L"退出");
      POINT position; GetCursorPos(&position); SetForegroundWindow(hwnd);
      const UINT choice = TrackPopupMenu(menu, TPM_RETURNCMD | TPM_RIGHTBUTTON,
          position.x, position.y, 0, hwnd, nullptr);
      DestroyMenu(menu);
      if (choice == 1) { ShowWindow(hwnd, SW_RESTORE); SetForegroundWindow(hwnd); }
      if (choice == 2 && desktop_channel_) desktop_channel_->InvokeMethod("trayExit", nullptr);
    }
    return 0;
  }
  if (message == RegisterWindowMessageW(L"TaskbarCreated") && tray_enabled_) {
    tray_enabled_ = false; SetTrayEnabled(true); return 0;
  }
  // Give Flutter, including plugins, an opportunity to handle window messages.
  if (flutter_controller_) {
    std::optional<LRESULT> result =
        flutter_controller_->HandleTopLevelWindowProc(hwnd, message, wparam,
                                                      lparam);
    if (result) {
      return *result;
    }
  }

  switch (message) {
    case WM_FONTCHANGE:
      flutter_controller_->engine()->ReloadSystemFonts();
      break;
  }

  return Win32Window::MessageHandler(hwnd, message, wparam, lparam);
}
