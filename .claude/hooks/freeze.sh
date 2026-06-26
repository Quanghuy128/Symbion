#!/usr/bin/env bash
# freeze hook — chặn Edit/Write ra ngoài thư mục được "đóng băng".
# Bật: ghi đường dẫn boundary vào .claude/.freeze (1 dòng/path, tương đối repo root).
# Tắt: xóa .claude/.freeze (hoặc /unfreeze).
# Hook PreToolUse cho Write|Edit. Exit 2 = chặn.
# Ý đồ: khi debug/điều tra, giới hạn vùng sửa để tránh đụng nhầm phần khác.

input=$(cat)
FREEZE_FILE="${CLAUDE_PROJECT_DIR:-.}/.claude/.freeze"

# Không có file freeze → không giới hạn gì
[ -f "$FREEZE_FILE" ] || exit 0

# Lấy file_path từ tool_input (Write/Edit đều có field này)
target=$(printf '%s' "$input" | grep -oP '"file_path"\s*:\s*"\K(\\.|[^"\\])*' | head -1)
[ -z "$target" ] && exit 0
# bỏ escape
target=$(printf '%s' "$target" | sed 's/\\"/"/g; s/\\\\/\\/g')

# Cho phép sửa chính file .freeze (để /unfreeze hoạt động) và file trong .claude/
case "$target" in
  *"/.claude/.freeze") exit 0 ;;
esac

# Đọc các boundary cho phép
allowed=0
while IFS= read -r dir; do
  [ -z "$dir" ] && continue
  # chuẩn hóa: bỏ ./ đầu, bỏ / cuối
  dir="${dir#./}"; dir="${dir%/}"
  # match nếu target nằm trong dir (so cả absolute lẫn tương đối)
  case "$target" in
    *"/$dir/"*|*"/$dir") allowed=1; break ;;
    "$dir/"*|"$dir") allowed=1; break ;;
  esac
done < "$FREEZE_FILE"

if [ "$allowed" -eq 0 ]; then
  echo "🧊 freeze: chặn sửa file ngoài vùng đóng băng." >&2
  echo "   File: $target" >&2
  echo "   Vùng cho phép (.claude/.freeze):" >&2
  sed 's/^/     - /' "$FREEZE_FILE" >&2
  echo "   Gỡ băng: /unfreeze (hoặc xóa .claude/.freeze)." >&2
  exit 2
fi
exit 0
