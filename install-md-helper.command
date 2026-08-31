#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
APP_DIR="$HOME/Library/Application Support/STARBUCKS HELPER"
AGENT_FILE="$HOME/Library/LaunchAgents/com.runipokr.starbucks-helper-md.plist"
LOG_DIR="$HOME/Library/Logs/STARBUCKS HELPER"
CODEX_PYTHON="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"

if [[ -x "$CODEX_PYTHON" ]]; then
  PYTHON_BIN="$CODEX_PYTHON"
elif /usr/bin/python3 -c 'import sys' >/dev/null 2>&1; then
  PYTHON_BIN="/usr/bin/python3"
else
  print "Python 실행 환경을 찾을 수 없습니다. Codex가 설치된 상태에서 다시 실행해주세요."
  read -k 1 "?아무 키나 누르면 닫힙니다."
  exit 1
fi

mkdir -p "$APP_DIR" "$HOME/Library/LaunchAgents" "$LOG_DIR" "$HOME/Downloads/스타벅스MD"
cp "$SCRIPT_DIR/local-md-helper.py" "$APP_DIR/local-md-helper.py"
chmod 700 "$APP_DIR/local-md-helper.py"

cat > "$AGENT_FILE" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.runipokr.starbucks-helper-md</string>
  <key>ProgramArguments</key><array>
    <string>$PYTHON_BIN</string>
    <string>$APP_DIR/local-md-helper.py</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG_DIR/md-helper.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/md-helper-error.log</string>
</dict></plist>
PLIST

launchctl bootout "gui/$(id -u)/com.runipokr.starbucks-helper-md" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$AGENT_FILE"
launchctl kickstart -k "gui/$(id -u)/com.runipokr.starbucks-helper-md"

print "STARBUCKS HELPER MD 로컬 다운로더 설치 완료"
print "저장 위치: $HOME/Downloads/스타벅스MD"
print "이 창은 닫아도 됩니다."
