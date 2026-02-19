# Installation

## Prerequisites

Hone delegates to the [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI (`claude`), which must be installed and authenticated before hone will work. We recommend the Claude Max plan for regular iteration on your codebase.

For [GitHub mode](/concepts/github-mode), the [GitHub CLI](https://cli.github.com/) (`gh`) must also be installed and authenticated.

## macOS (Homebrew)

```bash
brew tap svetzal/tap
brew install hone
```

## Linux

Download the binary from the [latest release](https://github.com/svetzal/hone-cli/releases/latest):

```bash
curl -L https://github.com/svetzal/hone-cli/releases/latest/download/hone-linux-x64.tar.gz | tar xz
sudo mv hone-linux-x64 /usr/local/bin/hone
```

## Windows

Download `hone-windows-x64.exe` from the [latest release](https://github.com/svetzal/hone-cli/releases/latest) and add it to your PATH.

## From source

Requires [Bun](https://bun.sh):

```bash
git clone https://github.com/svetzal/hone-cli.git
cd hone-cli
bun install
bun run build    # produces build/hone
```

## Verify

```bash
hone --version
```

You should see the current version number (e.g. `1.1.4`). If `claude` is not installed or not on your PATH, hone will fail at runtime when it tries to invoke it — the version check itself doesn't require Claude.
