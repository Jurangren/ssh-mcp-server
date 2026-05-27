#!/bin/bash
# 使用 python 启动一个伪终端进程，这会欺骗 node 认为自己在真实的 tty 中运行
# 并且通过 python 的阻塞特性防止管道被关闭
exec python3 -c "import pty, sys, os; pty.spawn(['/usr/bin/node', '/root/ssh-mcp-server/build/index.js', '--mcp-transport', 'http', '--http-host', '0.0.0.0', '--http-port', '3001', '--http-path', '/mcp'])"