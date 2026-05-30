#!/usr/bin/env python3
"""
CaseBuddy CLI — 一键启动/停止/查看 CaseBuddy 服务

用法：
  python casebuddy_cli.py start [frontend|backend|gateway|all]   # 启动服务
  python casebuddy_cli.py stop [frontend|backend|gateway|all]    # 停止服务
  python casebuddy_cli.py restart [frontend|backend|gateway|all] # 重启服务
  python casebuddy_cli.py status                                # 查看所有服务状态
  python casebuddy_cli.py logs [frontend|backend|gateway]        # 查看最近日志
  python casebuddy_cli.py help                                  # 显示帮助

默认 target=all

示例：
  python casebuddy_cli.py start          # 启动所有服务
  python casebuddy_cli.py start gateway  # 只启动 Python 网关
  python casebuddy_cli.py status         # 查看状态
  python casebuddy_cli.py stop all       # 停止所有服务

跨平台支持：Windows / macOS / Linux
"""

import os
import sys
import io
import time
import signal
import subprocess
import json
from pathlib import Path
from typing import Optional, List, Dict

# ─── 强制 UTF-8 输出（必须在所有 print 之前）─────────────────────────
os.environ['PYTHONUTF8'] = '1'

# 只在 stdout 有 buffer 且未被重定向为 UTF-8 时才重定向
def _ensure_utf8_stream(stream, name):
    """确保 stream 使用 UTF-8 编码"""
    try:
        enc = getattr(stream, 'encoding', None) or ''
        if enc.lower() in ('utf-8', 'utf8'):
            return stream  # 已经是 UTF-8
    except Exception:
        return stream
    try:
        if hasattr(stream, 'buffer') and hasattr(stream.buffer, 'read'):
            new_stream = io.TextIOWrapper(stream.buffer, encoding='utf-8', errors='replace', line_buffering=True)
            # 保存原始引用
            setattr(sys, f'__{name}_original__', stream)
            return new_stream
    except Exception:
        pass
    return stream

sys.stdout = _ensure_utf8_stream(sys.stdout, 'stdout')
sys.stderr = _ensure_utf8_stream(sys.stderr, 'stderr')

# 覆盖 builtins.print，确保所有 print() 自动 UTF-8
import builtins as _builtins
_original_print = _builtins.print
def _safe_print(*args, **kwargs):
    try:
        _original_print(*args, **kwargs)
        return
    except (UnicodeEncodeError, ValueError):
        pass
    except Exception:
        return
_builtins.print = _safe_print

# ─── 项目路径 ───

# 脚本所在目录的上级 = casebuddy 根目录
SCRIPT_DIR = Path(__file__).parent.absolute()
PROJECT_ROOT = SCRIPT_DIR  # gateway-python 目录即为 CLI 所在目录
CASEBUDDY_ROOT = PROJECT_ROOT.parent  # casebuddy/ 目录

FRONTEND_DIR = CASEBUDDY_ROOT / "frontend"
BACKEND_DIR = CASEBUDDY_ROOT / "backend"
GATEWAY_DIR = PROJECT_ROOT
TEMP_DIR = PROJECT_ROOT / "temp"

# PID 文件存储位置
PID_DIR = TEMP_DIR / "pids"
PID_DIR.mkdir(parents=True, exist_ok=True)

# 日志文件位置
LOG_DIR = TEMP_DIR / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)

# 颜色支持
NO_COLOR = os.environ.get('NO_COLOR', '')
HAS_COLOR = not NO_COLOR and sys.stdout.isatty()


def c(text: str, color: str) -> str:
    """给文本添加 ANSI 颜色"""
    if not HAS_COLOR:
        return text
    colors = {
        'red': '\033[91m', 'green': '\033[92m', 'yellow': '\033[93m',
        'blue': '\033[94m', 'magenta': '\033[95m', 'cyan': '\033[96m',
        'white': '\033[97m', 'bold': '\033[1m', 'dim': '\033[2m',
        'reset': '\033[0m',
    }
    return f"{colors.get(color, '')}{text}{colors['reset']}"


# ─── 环境检查与自动安装 ───

_SERVICE_PORTS = {
    'frontend': ('5173', '前端 Vite'),
    'backend': ('3001', '后端 Express'),
    'gateway': ('3002', 'Python 网关'),
}

# 旧 PID 文件路径（兼容旧版 start_gateway.py）
_LEGACY_GATEWAY_PID = GATEWAY_DIR / "gateway.pid"


def _get_port_by_name(name: str) -> str:
    """根据服务名获取端口号"""
    return _SERVICE_PORTS.get(name, ('', ''))[0]


def _find_pid_by_port(port: str) -> Optional[int]:
    """通过端口号查找占用进程的 PID（仅 Windows）"""
    if sys.platform != 'win32':
        return None
    try:
        out = subprocess.run(
            ['netstat', '-ano'], capture_output=True, timeout=5,
        ).stdout.decode('utf-8', errors='ignore')
        for line in out.splitlines():
            if f':{port}' in line and 'LISTENING' in line:
                parts = line.split()
                try:
                    return int(parts[-1])
                except (ValueError, IndexError):
                    continue
    except Exception:
        pass
    return None


def check_environment(auto_install: bool = False):
    """检查并报告运行环境状态。auto_install=True 时自动安装缺失依赖。"""
    issues = []
    ok_list = []

    print(c("\n  CaseBuddy 环境检查", 'bold'))
    print(c("  " + "─" * 55, 'dim'))

    # 1. Python 版本检查 (>= 3.8)
    py_ver = sys.version_info
    if py_ver >= (3, 8):
        ok_list.append(f"Python {py_ver.major}.{py_ver.minor}.{py_ver.micro}")
    else:
        issues.append(f"Python 版本过低: {py_ver.major}.{py_ver.minor}，需要 >= 3.8")

    # 2. Node.js 检查
    node = _find_node()
    if node:
        try:
            r = subprocess.run([node, '--version'], capture_output=True, timeout=5, text=True)
            ok_list.append(f"Node.js {r.stdout.strip()}")
        except:
            issues.append("Node.js 已找到但无法获取版本")
    else:
        issues.append("Node.js 未安装或不在 PATH 中")

    # 3. npm 检查
    npm = _find_npm()
    if npm:
        try:
            r = subprocess.run([npm, '--version'], capture_output=True, timeout=5, text=True)
            ok_list.append(f"npm {r.stdout.strip()}")
        except:
            issues.append("npm 已找到但无法获取版本")
    else:
        issues.append("npm 未安装或不在 PATH 中")

    # 4. npm 依赖检查
    if (FRONTEND_DIR / "node_modules").exists():
        ok_list.append("frontend/node_modules ✓")
    else:
        issues.append("前端依赖未安装 (frontend/node_modules 不存在)")

    if (BACKEND_DIR / "node_modules").exists():
        ok_list.append("backend/node_modules ✓")
    else:
        issues.append("后端依赖未安装 (backend/node_modules 不存在)")

    # 5. Python 依赖检查
    # import名 → pip包名 映射（注意：pip包名和import名可能不同）
    python_dep_map = {
        'requests': 'requests',
        'qrcode': 'qrcode',
        'Crypto': 'pycryptodome',
        'flask': 'flask',
        'botpy': 'qq-botpy',          # qq-botpy 的 import 名是 botpy
        'lark_oapi': 'lark-oapi',
        'aiohttp': 'aiohttp',
    }
    missing_py = []
    for import_name, pip_name in python_dep_map.items():
        try:
            __import__(import_name)
        except ImportError:
            try:
                # 尝试变体
                if import_name == 'Crypto':
                    __import__('Cryptodome')
                else:
                    raise
            except ImportError:
                missing_py.append(pip_name)
    if missing_py:
        issues.append(f"Python 依赖缺失: {', '.join(missing_py)}")
    else:
        ok_list.append("Python 依赖 (requests/qrcode/pycryptodome/flask/qq-botpy/lark-oapi/aiohttp) ✓")

    # 汇总输出
    print(f"\n  {c('通过项:', 'green')}")
    for item in ok_list:
        print(f"    {c('✓', 'green')} {item}")

    if issues:
        print(f"\n  {c('问题项:', 'yellow')}")
        for item in issues:
            print(f"    {c('✗', 'yellow')} {item}")

    # 6. 自动安装
    if auto_install and issues:
        print(f"\n  {c('→', 'blue')} 自动安装缺失依赖...")
        print(c("  " + "─" * 55, 'dim'))

        # 安装 Python 依赖
        if any('Python 依赖' in i for i in issues):
            req_file = GATEWAY_DIR / "requirements.txt"
            if req_file.exists():
                print(f"  {c('→', 'blue')} pip install -r requirements.txt ...")
                try:
                    r = subprocess.run(
                        [sys.executable, '-m', 'pip', 'install', '-r', str(req_file)],
                        capture_output=True, timeout=120, text=True,
                    )
                    if r.returncode == 0:
                        print(f"  {c('✓', 'green')} Python 依赖安装完成")
                    else:
                        print(f"  {c('⚠', 'yellow')} pip 安装有警告:\n{r.stderr[-300:]}")
                except Exception as e:
                    print(f"  {c('✗', 'red')} pip 安装失败: {e}")
            else:
                print(f"  {c('⚠', 'yellow')} 未找到 requirements.txt，尝试安装单个包...")
                for dep in missing_py:
                    pkg = 'pycryptodome' if dep.lower() == 'crypto' else dep
                    try:
                        subprocess.run(
                            [sys.executable, '-m', 'pip', 'install', pkg],
                            capture_output=True, timeout=60,
                        )
                    except:
                        pass

        # 安装前端依赖
        if any('前端依赖' in i for i in issues) and npm:
            print(f"  {c('→', 'blue')} npm install (frontend)...")
            try:
                r = subprocess.run(
                    ['npm', 'install'], cwd=str(FRONTEND_DIR),
                    capture_output=True, timeout=180, text=True,
                    shell=(sys.platform == 'win32'),
                )
                if r.returncode == 0:
                    print(f"  {c('✓', 'green')} 前端依赖安装完成")
                else:
                    print(f"  {c('⚠', 'yellow')} npm install 有警告:\n{r.stderr[-300:]}")
            except Exception as e:
                print(f"  {c('✗', 'red')} 前端 npm install 失败: {e}")

        # 安装后端依赖
        if any('后端依赖' in i for i in issues) and npm:
            print(f"  {c('→', 'blue')} npm install (backend)...")
            try:
                r = subprocess.run(
                    ['npm', 'install'], cwd=str(BACKEND_DIR),
                    capture_output=True, timeout=180, text=True,
                    shell=(sys.platform == 'win32'),
                )
                if r.returncode == 0:
                    print(f"  {c('✓', 'green')} 后端依赖安装完成")
                else:
                    print(f"  {c('⚠', 'yellow')} npm install 有警告:\n{r.stderr[-300:]}")
            except Exception as e:
                print(f"  {c('✗', 'red')} 后端 npm install 失败: {e}")

    print(c("  " + "─" * 55, 'dim'))
    return issues


# ─── PID 管理 ───

def _pid_file(name: str) -> Path:
    return PID_DIR / f"{name}.pid"


def _get_pid(name: str) -> Optional[int]:
    """读取 PID 文件（兼容旧版 gateway.pid）"""
    pf = _pid_file(name)
    if pf.exists():
        try:
            return int(pf.read_text().strip())
        except:
            pass
    # 备用：检查旧版 gateway.pid（由 start_gateway.py 写入）
    if name == 'gateway' and _LEGACY_GATEWAY_PID.exists():
        try:
            return int(_LEGACY_GATEWAY_PID.read_text().strip())
        except:
            pass
    return None


def _set_pid(name: str, pid: int):
    """写入 PID 文件，同时清理旧版 gateway.pid"""
    _pid_file(name).write_text(str(pid))
    # 清理旧版 PID 文件，统一使用 temp/pids/
    if name == 'gateway' and _LEGACY_GATEWAY_PID.exists():
        try:
            _LEGACY_GATEWAY_PID.unlink()
        except:
            pass


def _clear_pid(name: str):
    """删除 PID 文件（含旧版 gateway.pid）"""
    pf = _pid_file(name)
    if pf.exists():
        try:
            pf.unlink()
        except:
            pass
    if name == 'gateway' and _LEGACY_GATEWAY_PID.exists():
        try:
            _LEGACY_GATEWAY_PID.unlink()
        except:
            pass


def _is_running(name: str) -> bool:
    """检查进程是否在运行（PID + 端口双重检测）"""
    pid = _get_pid(name)
    has_pid = pid is not None

    # 方法1: PID 检测
    if has_pid:
        if sys.platform == 'win32':
            try:
                out = subprocess.run(
                    ['tasklist', '/FI', f'PID eq {pid}', '/NH', '/FO', 'CSV'],
                    capture_output=True, timeout=3
                ).stdout.decode('utf-8', errors='ignore')
                if f'"{pid}"' in out:
                    return True
            except subprocess.TimeoutExpired:
                print(f"  {c('⚠', 'yellow')} tasklist 超时，使用端口检测备用方案")
            except Exception as e:
                print(f"  {c('⚠', 'yellow')} tasklist 异常: {e}，使用端口检测备用方案")
        else:
            try:
                os.kill(pid, 0)
                return True
            except (OSError, ProcessLookupError):
                _clear_pid(name)

    # 方法2: 端口占用检测（备用于 Windows）
    if sys.platform == 'win32':
        port = _get_port_by_name(name)
        if port:
            try:
                out = subprocess.run(
                    ['netstat', '-ano'], capture_output=True, timeout=5,
                ).stdout.decode('utf-8', errors='ignore')
                for line in out.splitlines():
                    if f':{port}' in line and 'LISTENING' in line:
                        return True
            except Exception as e:
                print(f"  {c('⚠', 'yellow')} netstat 检测异常: {e}")

    return False


def _kill_process(name: str) -> bool:
    """终止进程（Windows 多层降级策略）"""
    pid = _get_pid(name)

    # PID 文件为空时，尝试通过端口检测找到 PID
    if pid is None:
        port = _get_port_by_name(name)
        if port:
            pid = _find_pid_by_port(port)

    if pid is None:
        _clear_pid(name)
        return True  # 没有进程记录，视为已停止

    killed = False

    if sys.platform == 'win32':
        # Windows 下先通过端口找所有占用进程（可能多个子进程）
        port = _get_port_by_name(name)
        port_pids = set()
        if port:
            try:
                out = subprocess.run(
                    ['netstat', '-ano'], capture_output=True, timeout=5,
                ).stdout.decode('utf-8', errors='ignore')
                for line in out.splitlines():
                    if f':{port}' in line and 'LISTENING' in line:
                        parts = line.split()
                        if parts:
                            port_pids.add(parts[-1])
            except Exception:
                pass

        # 收集所有需要杀死的 PID（原始 PID + 端口占用 PID）
        all_pids = {str(pid)}
        all_pids.update(port_pids)

        for kill_pid in all_pids:
            for method in ['/T /F', '/F']:
                try:
                    result = subprocess.run(
                        ['taskkill', '/PID', kill_pid, method],
                        capture_output=True, timeout=10,
                    )
                    if result.returncode in (0, 128):
                        killed = True
                        time.sleep(0.3)
                        break
                except subprocess.TimeoutExpired:
                    pass
                except Exception:
                    pass
            # 如果 taskkill 失败，尝试 PowerShell
            if not killed:
                try:
                    subprocess.run(
                        ['powershell', '-NoProfile', '-Command',
                         f'Stop-Process -Id {kill_pid} -Force -ErrorAction SilentlyContinue'],
                        capture_output=True, timeout=8,
                    )
                    # 验证
                    time.sleep(0.5)
                    verify = subprocess.run(
                        ['tasklist', '/FI', f'PID eq {kill_pid}', '/NH', '/FO', 'CSV'],
                        capture_output=True, timeout=3,
                    ).stdout.decode('utf-8', errors='ignore')
                    if f'"{kill_pid}"' not in verify:
                        killed = True
                except Exception:
                    pass

    else:
        # Linux / macOS
        try:
            os.kill(pid, signal.SIGTERM)
            for _ in range(10):
                time.sleep(0.5)
                try:
                    os.kill(pid, 0)
                except (OSError, ProcessLookupError):
                    killed = True
                    break
            else:
                os.kill(pid, signal.SIGKILL)
                time.sleep(0.5)
                try:
                    os.kill(pid, 0)
                except (OSError, ProcessLookupError):
                    killed = True
        except (OSError, ProcessLookupError):
            killed = True  # 进程已不存在
        except Exception:
            pass

    # ── 清理 & 报告 ────────────────────────────────────────────────────
    if killed:
        _clear_pid(name)
        print(f"  {c('[OK]', 'green')} {name} 已停止 (PID: {pid})")
        return True
    else:
        print(f"  {c('[FAIL]', 'red')} 无法终止 {name} (PID: {pid})，请手动: taskkill /PID {pid} /F")
        return False


# ─── 服务启动 ───

def _find_node() -> Optional[str]:
    """查找 node 可执行文件"""
    # 优先系统 node
    for candidate in ['node', '/c/Program Files/nodejs/node.exe']:
        try:
            result = subprocess.run([candidate, '--version'], capture_output=True, timeout=5)
            if result.returncode == 0:
                return candidate
        except:
            pass
    return None


def _find_npm() -> Optional[str]:
    """查找 npm（优先系统 PATH，再查 node 同级目录）"""
    # 优先：直接查系统 PATH
    for candidate in (['npm.cmd', 'npm'] if sys.platform == 'win32' else ['npm']):
        try:
            r = subprocess.run([candidate, '--version'], capture_output=True, timeout=5, text=True)
            if r.returncode == 0:
                # 返回完整路径
                if sys.platform == 'win32':
                    out = subprocess.run(['where', 'npm'], capture_output=True, text=True)
                    lines = out.stdout.strip().splitlines()
                    for line in lines:
                        if line.strip().endswith('.cmd'):
                            return line.strip()
                    if lines:
                        return lines[0].strip()
                return candidate
        except:
            pass

    # 备用：查 node 同级目录
    node = _find_node()
    if node:
        npm_path = Path(node).parent / ('npm.cmd' if sys.platform == 'win32' else 'npm')
        if npm_path.exists():
            return str(npm_path)
    return None


def _start_frontend():
    """启动前端 Vite 开发服务器"""
    if _is_running('frontend'):
        pid = _get_pid('frontend')
        if pid is None:
            pid = _find_pid_by_port('5173')
            if pid:
                _set_pid('frontend', pid)
        print(f"  {c('●', 'green')} 前端已在运行 (PID: {pid})")
        return

    node = _find_node()
    if not node:
        print(f"  {c('✗', 'red')} 未找到 node，无法启动前端")
        return

    vite_bin = FRONTEND_DIR / "node_modules" / "vite" / "bin" / "vite.js"
    if not vite_bin.exists():
        print(f"  {c('✗', 'red')} 前端依赖未安装，请先执行: cd frontend && npm install")
        return

    log_file = LOG_DIR / "frontend.log"
    cmd = [node, str(vite_bin), '--host']

    print(f"  {c('→', 'blue')} 启动前端 (Vite, port 5173)...")
    process = subprocess.Popen(
        cmd, cwd=str(FRONTEND_DIR),
        stdout=open(log_file, 'w'),
        stderr=subprocess.STDOUT,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == 'win32' else 0,
    )
    _set_pid('frontend', process.pid)
    time.sleep(2)

    if _is_running('frontend'):
        print(f"  {c('✓', 'green')} 前端启动成功 (PID: {process.pid}) → http://localhost:5173")
    else:
        print(f"  {c('✗', 'red')} 前端启动失败，查看日志: {log_file}")


def _start_backend():
    """启动后端 Node.js 服务"""
    if _is_running('backend'):
        pid = _get_pid('backend')
        if pid is None:
            pid = _find_pid_by_port('3001')
            if pid:
                _set_pid('backend', pid)
        print(f"  {c('●', 'green')} 后端已在运行 (PID: {pid})")
        return

    # 先编译 TypeScript
    node = _find_node()
    if not node:
        print(f"  {c('✗', 'red')} 未找到 node，无法启动后端")
        return

    tsc_bin = BACKEND_DIR / "node_modules" / "typescript" / "bin" / "tsc"
    if tsc_bin.exists():
        print(f"  {c('→', 'blue')} 编译 TypeScript...")
        result = subprocess.run(
            [node, str(tsc_bin)],
            cwd=str(BACKEND_DIR),
            capture_output=True, timeout=30,
        )
        if result.returncode != 0:
            print(f"  {c('⚠', 'yellow')} TypeScript 编译有警告，继续启动...")

    dist_index = BACKEND_DIR / "dist" / "index.js"
    if not dist_index.exists():
        print(f"  {c('✗', 'red')} 后端编译产物不存在: {dist_index}")
        return

    log_file = LOG_DIR / "backend.log"
    cmd = [node, 'dist/index.js']

    print(f"  {c('→', 'blue')} 启动后端 (port 3001)...")
    process = subprocess.Popen(
        cmd, cwd=str(BACKEND_DIR),
        stdout=open(log_file, 'w'),
        stderr=subprocess.STDOUT,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == 'win32' else 0,
    )
    _set_pid('backend', process.pid)
    time.sleep(2)

    if _is_running('backend'):
        print(f"  {c('✓', 'green')} 后端启动成功 (PID: {process.pid}) → http://localhost:3001")
    else:
        print(f"  {c('✗', 'red')} 后端启动失败，查看日志: {log_file}")


def _start_gateway():
    """启动 Python 网关服务"""
    if _is_running('gateway'):
        pid = _get_pid('gateway')
        if pid is None:
            pid = _find_pid_by_port('3002')
            if pid:
                _set_pid('gateway', pid)
        print(f"  {c('●', 'green')} Python网关已在运行 (PID: {pid})")
        return

    python = sys.executable
    # 检查当前 Python 是否有 requests 和 qrcode（lark_oapi 导入太慢，只检查核心依赖）
    try:
        result = subprocess.run(
            [python, '-c', 'import requests, qrcode; print("ok")'],
            capture_output=True, timeout=10, text=True,
        )
        if result.returncode != 0 or 'ok' not in (result.stdout or ''):
            # 当前 Python 缺少依赖，尝试查找系统 Python
            alt_pythons = []
            if sys.platform == 'win32':
                alt_pythons = [
                    str(Path.home() / 'AppData' / 'Local' / 'Programs' / 'Python' / 'Python312' / 'python.exe'),
                    str(Path.home() / 'AppData' / 'Local' / 'Programs' / 'Python' / 'Python311' / 'python.exe'),
                    'python3.12', 'python3.11', 'python3',
                ]
            for alt in alt_pythons:
                try:
                    r = subprocess.run(
                        [alt, '-c', 'import requests, qrcode; print("ok")'],
                        capture_output=True, timeout=10, text=True,
                    )
                    if r.returncode == 0 and 'ok' in (r.stdout or ''):
                        python = alt
                        print(f"  {c('→', 'blue')} 使用 {alt} (有必需依赖)")
                        break
                except Exception:
                    continue
    except Exception:
        pass

    log_file = LOG_DIR / "gateway.log"
    start_script = GATEWAY_DIR / "gateway_server.py"

    print(f"  {c('→', 'blue')} 启动 Python 网关 (port 3002)...")

    env = {**os.environ, 'PYTHONUTF8': '1'}

    process = subprocess.Popen(
        [python, str(start_script)],
        stdout=open(log_file, 'w'),
        stderr=subprocess.STDOUT,
        env=env,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == 'win32' else 0,
    )
    _set_pid('gateway', process.pid)
    time.sleep(3)

    if _is_running('gateway'):
        print(f"  {c('✓', 'green')} Python网关启动成功 (PID: {process.pid}) → http://localhost:3002")
    else:
        print(f"  {c('✗', 'red')} Python网关启动失败，查看日志: {log_file}")


# ─── 服务停止 ───

def _stop_frontend():
    if _is_running('frontend'):
        print(f"  {c('→', 'yellow')} 停止前端...")
        if _kill_process('frontend'):
            print(f"  {c('✓', 'green')} 前端已停止")
        else:
            print(f"  {c('✗', 'red')} 前端停止失败，请检查 tasklist 或手动结束进程")
    else:
        print(f"  {c('○', 'dim')} 前端未运行")


def _stop_backend():
    if _is_running('backend'):
        print(f"  {c('→', 'yellow')} 停止后端...")
        if _kill_process('backend'):
            print(f"  {c('✓', 'green')} 后端已停止")
        else:
            print(f"  {c('✗', 'red')} 后端停止失败，请检查 tasklist 或手动结束进程")
    else:
        print(f"  {c('○', 'dim')} 后端未运行")


def _stop_gateway():
    if _is_running('gateway'):
        print(f"  {c('→', 'yellow')} 停止 Python 网关...")
        if _kill_process('gateway'):
            print(f"  {c('✓', 'green')} Python网关已停止")
        else:
            print(f"  {c('✗', 'red')} Python网关停止失败，请检查 tasklist 或手动结束进程")
    else:
        print(f"  {c('○', 'dim')} Python网关未运行")


# ─── 状态检查 ───

def _check_health(port: int, name: str) -> bool:
    """检查 HTTP 健康端点"""
    try:
        import urllib.request
        req = urllib.request.Request(f'http://127.0.0.1:{port}/api/health', method='GET')
        with urllib.request.urlopen(req, timeout=3) as resp:
            return resp.status == 200
    except:
        pass
    # 网关没有 /api/health，用 /status
    if port == 3002:
        try:
            import urllib.request
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/status', timeout=3) as resp:
                return resp.status == 200
        except:
            pass
    return False


def show_status():
    """显示所有服务状态"""
    print(c("\n  CaseBuddy 服务状态", 'bold'))
    print(c("  " + "─" * 50, 'dim'))

    services = [
        ('frontend', '前端 (Vite)', 5173, '#'),
        ('backend', '后端 (Express)', 3001, '#'),
        ('gateway', 'Python 网关', 3002, '#'),
    ]

    all_running = True
    for name, label, port, _ in services:
        running = _is_running(name)
        pid = _get_pid(name)

        if running:
            healthy = _check_health(port, name)
            status_icon = c('●', 'green') if healthy else c('●', 'yellow')
            health_text = 'healthy' if healthy else 'starting...'
            pid_text = f'PID: {pid}'
            print(f"  {status_icon} {label:<20} {c(f'http://localhost:{port}', 'cyan'):25} {pid_text:<15} {health_text}")
        else:
            all_running = False
            print(f"  {c('○', 'dim')} {label:<20} {c(f'http://localhost:{port}', 'dim'):25} {'未运行'}")

    print(c("  " + "─" * 50, 'dim'))

    if all_running:
        print(c(f"  ✓ 所有服务运行正常！访问: http://localhost:5173", 'green'))
    else:
        print(c("  ⚠ 部分服务未运行。使用 'python casebuddy_cli.py start' 启动。", 'yellow'))

    print()


def show_logs(target: str):
    """显示最近的日志"""
    log_map = {
        'frontend': LOG_DIR / 'frontend.log',
        'backend': LOG_DIR / 'backend.log',
        'gateway': LOG_DIR / 'gateway.log',
    }
    log_file = log_map.get(target)
    if not log_file or not log_file.exists():
        print(f"  {c('✗', 'red')} 未找到 {target} 的日志文件")
        return

    lines = log_file.read_text(encoding='utf-8', errors='ignore').splitlines()
    recent = lines[-30:]  # 最近30行

    print(c(f"\n  {target} 最近日志 (最后 {len(recent)} 行):", 'bold'))
    print(c("  " + "─" * 60, 'dim'))
    for line in recent:
        print(f"  {line}")
    print()


# ─── 新增命令 ───

def cmd_check():
    """仅检查环境，不安装"""
    issues = check_environment(auto_install=False)
    print()
    if issues:
        print(c(f"  共发现 {len(issues)} 个问题，运行以下命令修复：", 'yellow'))
        print(c("    python casebuddy_cli.py install", 'cyan'))
    else:
        print(c("  ✓ 环境一切正常！", 'green'))


def cmd_install():
    """安装所有缺失依赖"""
    print(c("\n  开始安装缺失依赖...", 'bold'))
    check_environment(auto_install=True)


def cmd_doctor():
    """诊断并报告所有问题（端口占用、进程残留等）"""
    print(c("\n  CaseBuddy Doctor — 全面诊断", 'bold'))
    print(c("  " + "─" * 55, 'dim'))

    issues_found = []

    # 1. 端口占用检查
    print(f"\n  {c('[1/4]', 'blue')} 端口占用检查")
    for name, (port, label) in _SERVICE_PORTS.items():
        if sys.platform == 'win32':
            try:
                out = subprocess.run(
                    ['netstat', '-ano'], capture_output=True, timeout=5,
                ).stdout.decode('utf-8', errors='ignore')
                for line in out.splitlines():
                    if f':{port}' in line and 'LISTENING' in line:
                        parts = line.split()
                        pid_on_port = parts[-1]
                        # 检查是否是我们的进程
                        our_pid = _get_pid(name)
                        if our_pid and str(our_pid) == pid_on_port:
                            print(f"    {c('✓', 'green')} {label} (port {port}) → 进程 {pid_on_port} (由CLI管理)")
                        else:
                            print(f"    {c('⚠', 'yellow')} {label} (port {port}) → 被未知进程 PID {pid_on_port} 占用！")
                            issues_found.append(f"端口 {port} 被未知进程 PID {pid_on_port} 占用")
                        break
                else:
                    print(f"    {c('○', 'dim')} {label} (port {port}) → 未被占用")
            except Exception as e:
                print(f"    {c('⚠', 'yellow')} 无法检查端口 {port}: {e}")

    # 2. 进程残留检查
    print(f"\n  {c('[2/4]', 'blue')} 进程残留检查")
    for name in ['frontend', 'backend', 'gateway']:
        pid = _get_pid(name)
        running = _is_running(name)
        if running:
            print(f"    {c('●', 'green')} {name}: 运行中 (PID: {pid})")
        elif pid:
            print(f"    {c('⚠', 'yellow')} {name}: PID 文件存在 ({pid}) 但进程不在运行 → 残留 PID 文件")
            issues_found.append(f"{name} 残留 PID 文件 (PID: {pid})")
        else:
            print(f"    {c('○', 'dim')} {name}: 未运行")

    # 3. 旧版 PID 文件检查
    print(f"\n  {c('[3/4]', 'blue')} 旧版 PID 文件检查")
    if _LEGACY_GATEWAY_PID.exists():
        try:
            old_pid = _LEGACY_GATEWAY_PID.read_text().strip()
            print(f"    {c('⚠', 'yellow')} 发现旧版 gateway.pid (PID: {old_pid})，建议清理")
            issues_found.append(f"旧版 gateway.pid 未清理 (PID: {old_pid})")
        except:
            print(f"    {c('⚠', 'yellow')} 发现旧版 gateway.pid（无法读取）")
    else:
        print(f"    {c('✓', 'green')} 无旧版 PID 文件")

    # 4. 环境依赖检查
    print(f"\n  {c('[4/4]', 'blue')} 环境依赖检查")
    env_issues = check_environment(auto_install=False)
    issues_found.extend(env_issues)

    # 汇总
    print(c("\n  " + "─" * 55, 'dim'))
    if issues_found:
        print(c(f"  诊断完成，发现 {len(issues_found)} 个问题：", 'yellow'))
        for i, iss in enumerate(issues_found, 1):
            print(f"    {i}. {iss}")
        print(c("\n  建议执行: python casebuddy_cli.py install", 'cyan'))
    else:
        print(c("  ✓ 未发现任何问题，系统健康！", 'green'))
    print()


# ─── 命令处理 ───

def cmd_start(targets: List[str]):
    """启动指定服务"""
    if 'all' in targets or not targets:
        targets = ['backend', 'gateway', 'frontend']

    print(c(f"\n  CaseBuddy 启动中...", 'bold'))
    print(c("  " + "─" * 50, 'dim'))

    start_map = {
        'frontend': _start_frontend,
        'backend': _start_backend,
        'gateway': _start_gateway,
    }

    for target in targets:
        func = start_map.get(target)
        if func:
            print(f"\n  {c(f'[{target}]', 'bold')}")
            func()
        else:
            print(f"  {c('✗', 'red')} 未知服务: {target}")

    print()
    show_status()


def cmd_stop(targets: List[str]):
    """停止指定服务"""
    if 'all' in targets or not targets:
        targets = ['frontend', 'backend', 'gateway']

    print(c(f"\n  CaseBuddy 停止中...", 'bold'))
    print(c("  " + "─" * 50, 'dim'))

    stop_map = {
        'frontend': _stop_frontend,
        'backend': _stop_backend,
        'gateway': _stop_gateway,
    }

    for target in targets:
        func = stop_map.get(target)
        if func:
            print(f"  {c(f'[{target}]', 'bold')}")
            func()
        else:
            print(f"  {c('✗', 'red')} 未知服务: {target}")

    print()


def cmd_restart(targets: List[str]):
    """重启指定服务"""
    cmd_stop(targets)
    time.sleep(1)
    cmd_start(targets)


def show_help():
    """显示帮助"""
    help_text = f"""
{c('CaseBuddy CLI', 'bold')} — 一键管理 CaseBuddy 开发环境

{c('用法:', 'yellow')}
  python casebuddy_cli.py <command> [target]

{c('命令:', 'yellow')}
  start   [target]    启动服务 (默认: all)
  stop    [target]    停止服务 (默认: all)
  restart [target]    重启服务 (默认: all)
  status              查看所有服务状态
  logs    [target]    查看最近日志
  check               仅检查环境，不安装
  install             安装所有缺失依赖
  doctor              全面诊断（端口/进程/环境）

{c('目标 (target):', 'yellow')}
  frontend            前端 Vite 开发服务器 (port 5173)
  backend             后端 Express API (port 3001)
  gateway             Python 网关 (port 3002)
  all                 所有服务 (默认)

{c('示例:', 'yellow')}
  python casebuddy_cli.py start                {c('# 启动全部', 'dim')}
  python casebuddy_cli.py start gateway        {c('# 只启动网关', 'dim')}
  python casebuddy_cli.py restart backend      {c('# 重启后端', 'dim')}
  python casebuddy_cli.py logs backend         {c('# 查看后端日志', 'dim')}
  python casebuddy_cli.py status               {c('# 查看状态', 'dim')}
  python casebuddy_cli.py doctor               {c('# 全面诊断', 'dim')}

{c('项目路径:', 'yellow')}
  前端: {FRONTEND_DIR}
  后端: {BACKEND_DIR}
  网关: {GATEWAY_DIR}
  PID:  {PID_DIR}
  日志: {LOG_DIR}
"""
    print(help_text)


def main():
    args = sys.argv[1:]

    if not args or args[0] in ('help', '-h', '--help'):
        show_help()
        return

    command = args[0]
    targets = [t.lower() for t in args[1:]] if len(args) > 1 else ['all']

    # 新命令：不需要 target 参数
    no_target_cmds = {'check', 'install', 'doctor'}
    if command not in no_target_cmds:
        valid_targets = {'frontend', 'backend', 'gateway', 'all'}
        for t in targets:
            if t not in valid_targets:
                print(f"  {c('✗', 'red')} 未知目标: {t}")
                print(f"  可用目标: {', '.join(valid_targets)}")
                sys.exit(1)

    # 在执行 start 前自动检查环境（自动安装缺失依赖）
    if command == 'start':
        check_environment(auto_install=True)

    if command == 'start':
        cmd_start(targets)
    elif command == 'stop':
        cmd_stop(targets)
    elif command == 'restart':
        cmd_restart(targets)
    elif command == 'status':
        show_status()
    elif command == 'logs':
        log_target = targets[0] if targets and targets[0] != 'all' else 'gateway'
        show_logs(log_target)
    elif command == 'check':
        cmd_check()
    elif command == 'install':
        cmd_install()
    elif command == 'doctor':
        cmd_doctor()
    else:
        print(f"  {c('✗', 'red')} 未知命令: {command}")
        print(f"  使用 'python casebuddy_cli.py help' 查看帮助")
        sys.exit(1)


if __name__ == '__main__':
    main()
