# codecolab
A real-time collaborative Python IDE featuring multi-user editing, WebRTC voice chat, interactive whiteboards, and a Gemini-powered AI assistant. Built with Spring Boot and React.
# 🚀 codecolab: Real-Time Collaborative Workspace

CoCode is a comprehensive, real-time collaborative coding environment and social platform built for developers and study groups. It combines the live-syncing power of a modern IDE with the communication tools of a team workspace. 

Whether you are pair-programming, diagramming architectures on a shared whiteboard, or debugging with an integrated AI assistant, CoCode keeps everyone in sync with sub-second latency.

### ✨ Key Features
* **Multiplayer Editor:** Real-time code synchronization and live cursor tracking using Yjs (CRDT) and WebSockets.
* **Live Python Execution:** Compile and run Python code directly within the shared environment.
* **Visual Collaboration:** Built-in real-time interactive whiteboard for system design and diagramming.
* **Communication Suite:** Peer-to-peer WebRTC voice chat and persistent in-environment text chat.
* **Social Graph & Teams:** Global user search, friend requests, group creation, and persistent group chats.
* **Granular Security (RBAC):** Share environments via Quick-Join codes with strict Read/Write/Execute permission controls and comprehensive Admin Audit Logs.
* **Smart AI Assistant:** Integrated Google Gemini AI to help debug and explain code contextually.

### 🛠️ Tech Stack
* **Frontend:** React 18, TypeScript, Vite, TailwindCSS, Monaco Editor, Yjs, Konva.js.
* **Backend:** Java 21, Spring Boot 3.x, Spring WebSockets, Spring AI.
* **Database & Cache:** PostgreSQL 18, Redis.
