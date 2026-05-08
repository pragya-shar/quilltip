# Changelog

All notable changes to this project will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.10.0] - 2026-03-28

### Added

- Mobile navigation menu with animated slide-in panel and outside-click-to-close
- Dark mode with light/dark/system toggle; theme persists across sessions
- Unsaved changes warning in the editor (browser prompt and in-app dialog)
- Consistent user avatars with initials fallback across profile, articles, and highlights
- Profile avatar editor with image upload and Wikimedia integration
- Unit tests for earnings dashboard components and avatar utilities

### Changed

- Error page redesigned with branded illustration and retry/home actions
- 404 page redesigned with branded illustration and browse-articles link
- Tip popup converted to accessible dialog; slides up on mobile, centers on desktop; blocks close during transactions
- Withdrawal popup converted to accessible dialog with focus management
- Earnings dashboard split into focused sections: stats, tip history, monthly chart, top articles, wallet notice
- Navigation links use semantic color tokens for dark mode support
- Auth, landing, guide, highlight, and editor surfaces updated for dark mode contrast

## [0.9.1] - 2026-03-18

### Added

- Editor page with TipTap rich text editing
- Stellar tipping via Soroban smart contracts
- Arweave permanent article storage
- Highlight and annotation system
- Article NFT minting
- User authentication via Convex Auth
- Delete draft functionality and editor keyboard shortcuts
- Centralized Convex types, data hooks, and editor styling
- Design tokens and semantic theming

### Infrastructure

- Next.js 16 with Turbopack
- Convex backend
- Vercel deployment
- CI via GitHub Actions (lint, typecheck, test, build)
- Claude Code review integration

## [0.9.0] - 2026-02-26

Initial pre-release.
