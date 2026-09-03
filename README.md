# PπBot

PπBot is an autonomous, terminal-based AI coding assistant. It interfaces directly with leading large language models (Google Gemini, Anthropic Claude, and OpenAI) within your local environment, enabling the agent to analyze codebases, perform surgical file edits, and execute shell commands to build and debug software alongside the developer.

---

## Features

- **Lightweight Architecture**: Implemented with native HTTP requests and zero dependency on heavy agent orchestration frameworks (such as LangChain or LangGraph).
- **Multi-Provider Support**: Seamlessly switch between Google Gemini, Anthropic Claude, and OpenAI through command-line flags.
- **Autonomous Execution Loop**: Utilizes a structured Think-Act-Observe cycle to iteratively decompose complex problems, execute builds, inspect error logs, and self-correct.
- **Extensible Tool Registry**:
  - `list_directory`: Inspect repository structure and directory hierarchies.
  - `read_file`: Inspect file contents with line-number context.
  - `search_codebase`: Pattern and keyword matching across the workspace.
  - `write_file`: Generate new files or replace existing file contents.
  - `edit_file`: Perform deterministic code modifications using exact string matching.
  - `execute_command`: Execute shell commands, test suites, and build scripts.
- **Safety and Sandboxing**:
  - **Path Sandboxing**: Enforces workspace boundary checks to prevent directory traversal.
  - **Human-in-the-Loop Safeguards**: High-risk shell operations (such as file deletion, root privileges, or remote repository modifications) require explicit user confirmation.
  - **Context Optimization**: Automatically manages token consumption through history pruning while keeping system instructions and task objectives pinned.

---

## Installation and Setup

### Prerequisites
- Node.js (v18 or higher recommended)
- npm or equivalent package manager

### 1. Clone the Repository
```bash
git clone https://github.com/SagnikGos/PiBot.git
cd PiBot
```

### 2. Install Dependencies and Build
```bash
npm install
npm run build
```

### 3. Global Link (Optional)
To invoke the `pibot` binary from any directory on your system:
```bash
npm link
```

### 4. Configure Environment Variables
Create an environment configuration file:
```bash
cp .env.example .env
```
Provide API keys for the providers you intend to use:
```env
GEMINI_API_KEY="your-gemini-key"
ANTHROPIC_API_KEY="your-anthropic-key"
OPENAI_API_KEY="your-openai-key"
```

---

## Usage

Start the assistant within any project directory:

```bash
# Launch PπBot in the current directory using the default provider (Gemini)
pibot

# Specify a target project directory
pibot --path ~/projects/my-app

# Run with a specific provider and model
pibot --provider anthropic --model claude-3-5-sonnet-20240620
```

### Command-Line Options

| Option | Description |
| :--- | :--- |
| `-p, --path <dir>` | Path to the target project root (default: `.`) |
| `--provider <name>` | LLM provider to use (`gemini`, `anthropic`, `openai`) |
| `-m, --model <name>` | Specific model identifier |
| `--max-iterations <n>` | Maximum autonomous loop cycles per prompt (default: `25`) |
| `--list-providers` | Display configured providers, default models, and key validity |

### Interactive REPL Commands

During an active session, standard prompts can be submitted directly. System-level commands include:

| Command | Description |
| :--- | :--- |
| `/tools` | List all available tools and capabilities |
| `/clear` | Reset active conversation history and restore clean context |
| `/help` | Display interactive command reference |
| `/exit` | Terminate the session |

---

## Architecture

The system is structured across four primary components:

1. **Interface Layer**: Handles CLI invocation, argument parsing, interactive REPL management, and provider routing.
2. **Dynamic Tool Registry**: Scans and loads tool implementations from `src/tools/`, converting them into schema-compliant definitions for LLM function calling.
3. **Autonomous Runtime Engine**: Manages the agent execution loop, coordinates LLM communications, executes tool requests, and returns structured feedback into context.
4. **Safety & Guardrails Layer**: Enforces file-system boundary restrictions and intercepts dangerous commands for operator verification.

---

## License

Distributed under the MIT License. See `LICENSE` for details.
