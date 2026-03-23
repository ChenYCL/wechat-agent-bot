#!/usr/bin/env bash
#
# WeChat Agent Bot — 一键环境安装 + 项目初始化
#
# 支持: macOS (Intel/Apple Silicon) / Linux (x64/arm64)
# 自动检测并安装: Node.js >=22, Python >=3.10, 项目依赖
#
set -euo pipefail

# ── 颜色 ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $*"; exit 1; }

# ── 系统检测 ──
detect_os() {
  case "$(uname -s)" in
    Darwin) OS="macos" ;;
    Linux)  OS="linux" ;;
    *)      fail "Unsupported OS: $(uname -s). Only macOS and Linux are supported." ;;
  esac

  case "$(uname -m)" in
    x86_64)       ARCH="x64" ;;
    arm64|aarch64) ARCH="arm64" ;;
    *)            fail "Unsupported arch: $(uname -m)" ;;
  esac

  info "Detected: ${OS} / ${ARCH}"
}

# ── Homebrew (macOS) ──
ensure_homebrew() {
  if [[ "$OS" != "macos" ]]; then return; fi
  if command -v brew &>/dev/null; then
    ok "Homebrew found"
    return
  fi
  info "Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Add to PATH for Apple Silicon
  if [[ "$ARCH" == "arm64" ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
    if ! grep -q 'brew shellenv' ~/.zprofile 2>/dev/null; then
      echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
    fi
  fi
  ok "Homebrew installed"
}

# ── Node.js >=22 ──
NODE_MIN=22

check_node_version() {
  if ! command -v node &>/dev/null; then return 1; fi
  local ver
  ver=$(node -v | sed 's/^v//' | cut -d. -f1)
  [[ "$ver" -ge "$NODE_MIN" ]]
}

install_node() {
  if check_node_version; then
    ok "Node.js $(node -v) >= v${NODE_MIN}"
    return
  fi

  warn "Node.js >= v${NODE_MIN} not found"

  # 优先用 fnm (快)，其次 nvm，最后 brew / apt
  if command -v fnm &>/dev/null; then
    info "Installing Node.js v${NODE_MIN} via fnm..."
    fnm install "$NODE_MIN" && fnm use "$NODE_MIN" && fnm default "$NODE_MIN"
  elif command -v nvm &>/dev/null; then
    info "Installing Node.js v${NODE_MIN} via nvm..."
    nvm install "$NODE_MIN" && nvm use "$NODE_MIN" && nvm alias default "$NODE_MIN"
  elif [[ "$OS" == "macos" ]]; then
    ensure_homebrew
    # 先尝试 fnm，没有就装 fnm
    if ! command -v fnm &>/dev/null; then
      info "Installing fnm via Homebrew..."
      brew install fnm
      eval "$(fnm env)"
      if ! grep -q 'fnm env' ~/.zshrc 2>/dev/null; then
        echo 'eval "$(fnm env)"' >> ~/.zshrc
      fi
    fi
    info "Installing Node.js v${NODE_MIN} via fnm..."
    fnm install "$NODE_MIN" && fnm use "$NODE_MIN" && fnm default "$NODE_MIN"
  elif [[ "$OS" == "linux" ]]; then
    # Linux: 用 fnm
    if ! command -v fnm &>/dev/null; then
      info "Installing fnm..."
      curl -fsSL https://fnm.vercel.app/install | bash
      export PATH="$HOME/.local/share/fnm:$PATH"
      eval "$(fnm env)"
    fi
    info "Installing Node.js v${NODE_MIN} via fnm..."
    fnm install "$NODE_MIN" && fnm use "$NODE_MIN" && fnm default "$NODE_MIN"
  fi

  # 验证
  if ! check_node_version; then
    fail "Failed to install Node.js >= v${NODE_MIN}. Please install manually: https://nodejs.org/"
  fi
  ok "Node.js $(node -v) installed"
}

# ── Python >=3.10 (可选，给 MCP 工具用) ──
PYTHON_MIN=10

check_python_version() {
  local cmd
  for cmd in python3 python; do
    if command -v "$cmd" &>/dev/null; then
      local ver
      ver=$("$cmd" --version 2>&1 | grep -oE '[0-9]+\.[0-9]+' | head -1)
      local minor
      minor=$(echo "$ver" | cut -d. -f2)
      if [[ "$minor" -ge "$PYTHON_MIN" ]]; then
        PYTHON_CMD="$cmd"
        return 0
      fi
    fi
  done
  return 1
}

install_python() {
  if check_python_version; then
    ok "Python $($PYTHON_CMD --version) >= 3.${PYTHON_MIN}"
    return
  fi

  warn "Python >= 3.${PYTHON_MIN} not found (optional, needed for some MCP tools)"

  if [[ "$OS" == "macos" ]]; then
    ensure_homebrew
    info "Installing Python via Homebrew..."
    brew install python@3.12
  elif [[ "$OS" == "linux" ]]; then
    if command -v apt-get &>/dev/null; then
      info "Installing Python via apt..."
      sudo apt-get update && sudo apt-get install -y python3 python3-pip python3-venv
    elif command -v dnf &>/dev/null; then
      info "Installing Python via dnf..."
      sudo dnf install -y python3 python3-pip
    elif command -v pacman &>/dev/null; then
      info "Installing Python via pacman..."
      sudo pacman -S --noconfirm python python-pip
    else
      warn "Cannot auto-install Python. Please install manually."
      return
    fi
  fi

  if check_python_version; then
    ok "Python $($PYTHON_CMD --version) installed"
  else
    warn "Python install skipped — some MCP tools may not work"
  fi
}

# ── 项目依赖安装 ──
install_deps() {
  local project_dir
  project_dir="$(cd "$(dirname "$0")" && pwd)"

  info "Installing project dependencies..."
  cd "$project_dir"
  npm install
  ok "Main dependencies installed"

  info "Installing WebUI dependencies..."
  cd "$project_dir/webui"
  npm install
  ok "WebUI dependencies installed"

  cd "$project_dir"
}

# ── .env 初始化 ──
init_env() {
  local project_dir
  project_dir="$(cd "$(dirname "$0")" && pwd)"

  if [[ ! -f "$project_dir/.env" ]]; then
    cp "$project_dir/.env.example" "$project_dir/.env"
    warn "Created .env from .env.example — please edit it with your API keys"
  else
    ok ".env already exists"
  fi
}

# ── 数据目录 + 配置模板 ──
init_data_dir() {
  local project_dir
  project_dir="$(cd "$(dirname "$0")" && pwd)"
  mkdir -p "$project_dir/data"

  if [[ ! -f "$project_dir/data/config.json" ]] && [[ -f "$project_dir/config.example.json" ]]; then
    cp "$project_dir/config.example.json" "$project_dir/data/config.json"
    warn "Created data/config.json from template — edit it or configure via WebUI"
  fi

  ok "Data directory ready"
}

# ── 主流程 ──
main() {
  echo ""
  echo "=========================================="
  echo "  WeChat Agent Bot — Setup"
  echo "=========================================="
  echo ""

  detect_os
  install_node
  install_python
  install_deps
  init_env
  init_data_dir

  echo ""
  echo "=========================================="
  echo -e "  ${GREEN}Setup complete!${NC}"
  echo "=========================================="
  echo ""
  echo "  Next steps:"
  echo "    1. Edit .env with your API keys"
  echo "    2. npm run dev        — start bot (dev mode)"
  echo "    3. npm run webui:dev  — start WebUI (dev mode)"
  echo ""
  echo "  Or run E2E tests:"
  echo "    npm run test:e2e"
  echo ""
}

main "$@"
