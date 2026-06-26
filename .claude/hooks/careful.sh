#!/usr/bin/env bash
# careful hook — chặn lệnh phá hủy trước khi Bash chạy (PreToolUse).
# Đọc JSON từ stdin, soi tool_input.command. Exit 2 = chặn.
# Bài học: DB incident trước đây → không bao giờ để lệnh phá hủy chạy vô tình.

input=$(cat)
cmd=$(printf '%s' "$input" | grep -oP '"command"\s*:\s*"\K(\\.|[^"\\])*' | head -1)

[ -z "$cmd" ] && exit 0

# Bỏ escape cơ bản để match cho dễ
decoded=$(printf '%s' "$cmd" | sed 's/\\"/"/g; s/\\\\/\\/g')

block() {
  echo "🛑 careful: lệnh bị chặn — $1" >&2
  echo "   Lệnh: $decoded" >&2
  echo "   Nếu thật sự cần, chạy thủ công ngoài Claude." >&2
  exit 2
}

# rm -rf nguy hiểm (root, home, *, .)
echo "$decoded" | grep -qiE 'rm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\s+(/|~|\$HOME|\.\s*$|\*)' && block "rm -rf vào đường dẫn nguy hiểm"
echo "$decoded" | grep -qiE 'rm\s+-rf\s+/(\s|$)' && block "rm -rf /"

# SQL phá hủy
echo "$decoded" | grep -qiE '\bDROP\s+(TABLE|DATABASE|SCHEMA)\b' && block "DROP TABLE/DATABASE/SCHEMA"
echo "$decoded" | grep -qiE '\bTRUNCATE\b' && block "TRUNCATE"
echo "$decoded" | grep -qiE '\bDELETE\s+FROM\b' && ! echo "$decoded" | grep -qiE '\bWHERE\b' && block "DELETE FROM không có WHERE"

# git phá hủy
echo "$decoded" | grep -qiE 'git\s+push\s+.*(--force|-f)\b' && block "git push --force"
echo "$decoded" | grep -qiE 'git\s+reset\s+--hard' && block "git reset --hard"

exit 0
