# Combark Shorts Studio - Windows Development Setup

## Requirements

- Windows 10/11
- Node.js 24 LTS
- npm
- VS Code
- PowerShell or Command Prompt

## Install the project

```powershell
npm install
```

## Run the development app

```powershell
npm start
```

The first Electron run may need to download the Electron binary. The first run can take longer depending on the network environment.

## Test

```powershell
npm test -- --passWithNoTests
```

## TypeScript check

```powershell
npm run typecheck
```

## ESLint check

```powershell
npm run lint
```

## Package for Windows

```powershell
npm run package
```

Packaged output is created under `out/` by default.

## Current Phase 1 output

```text
Combark Shorts Studio
Windows desktop application
Version 0.1.0
```