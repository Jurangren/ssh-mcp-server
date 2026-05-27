#!/bin/bash
# 切换到项目目录
cd /root/ssh-mcp-server
# 执行命令并将输出重定向，同时不要使用 nohup，让进程保持在前台
exec /usr/bin/node /root/ssh-mcp-server/build/index.js --mcp-transport http --http-host 0.0.0.0 --http-port 3001 --http-path /mcp