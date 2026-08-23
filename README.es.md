<div align="center">

# LumaForge

**Un gestor de biblioteca de juegos de escritorio construido con Tauri v2.**

![Licencia](https://img.shields.io/badge/licencia-GPL--3.0-blue)
![Versión](https://img.shields.io/badge/version-0.1.0--unreleased-purple)
![Plataforma](https://img.shields.io/badge/plataforma-Windows%2010%2F11-0078d4)
![Rust](https://img.shields.io/badge/Rust-1.77+-orange?logo=rust)
![Tauri](https://img.shields.io/badge/Tauri-v2-FFC131?logo=tauri)
![TypeScript](https://img.shields.io/badge/TypeScript-5.4+-3178c6?logo=typescript)
![React](https://img.shields.io/badge/React-19-61dafb?logo=react)

[English](README.md) · [Español](README.es.md)

</div>

---

## Descargo de Responsabilidad

LumaForge es un **proyecto educativo** y una **demostración técnica** del desarrollo de aplicaciones de escritorio modernas utilizando Tauri v2, Rust, React y TypeScript. Está diseñado para mostrar patrones avanzados de arquitectura de software, incluyendo sistemas de plugins, integración de scripting Lua, detección de juegos multi-proveedor, colas de trabajo en segundo plano y caché respaldada por SQLite.

**LumaForge no está afiliado, respaldado ni conectado con Valve Corporation, Steam, Epic Games, ni ninguna distribuidora de juegos.** Todas las marcas registradas pertenecen a sus respectivos propietarios.

Este software se proporciona estrictamente con fines educativos y de demostración. Los usuarios son responsables de garantizar el cumplimiento de todas las leyes aplicables y los términos de servicio de las plataformas y juegos con los que interactúen a través de este software.

---

## Características

| Característica | Descripción |
|----------------|-------------|
| **Biblioteca Multi-Proveedor** | Biblioteca unificada de juegos de Steam, Epic Games, scripts Lua y entradas manuales |
| **Lanzamiento Nativo** | Lanzamiento directo de juegos de Steam y Epic con seguimiento de procesos y grabación de tiempo de juego |
| **Integración Debrid/Torrent** | Descarga e instala juegos a través de proveedores debrid (TorBox, Real-Debrid, AllDebrid, Premiumize) o cliente torrent integrado (librqbit) |
| **Seguimiento de Logros** | Monitoreo en tiempo real de logros con notificaciones de desbloqueo, seguimiento de progreso e integración con Steam |
| **Modo Consola** | Interfaz navegable con gamepad a pantalla completa inspirada en Steam Big Picture y Solaris |
| **Correcciones de Juegos** | Aplicación con un clic de SmokeAPI, Steamless, Goldberg Emulator, Online-Fix y Koaloader |
| **Gestión de Medios** | Resolución automática de arte de Steam, SteamGridDB, IGDB y RAWG con cadenas de prioridad |
| **Panel Inteligente** | Pantalla de inicio personalizada con Jugar Continuar, Favoritos, Recomendaciones y secciones de descubrimiento |
| **Sistema de Extensiones** | Arquitectura de plugins basada en Lua para integración de herramientas de terceros y detección de juegos |
| **Fondos Ambientales** | Fondos dinámicos impulsados por temas con modo de color, modo de imagen y transiciones de fundido |
| **Gestor Universal de Descargas** | Cola unificada para instalaciones de Steam, descargas debrid y transferencias torrent con gráficos de velocidad en vivo |
| **Almacenamiento SQLite-First** | Todos los datos del juego, tiempo de juego, logros y configuración persistidos en SQLite con migración JSON |

## Stack Tecnológico

| Capa | Tecnología |
|------|-----------|
| **Backend** | Rust (Tauri v2.11.3) |
| **Frontend** | React 19 + TypeScript 5.4 + Vite 8.2 |
| **Base de Datos** | SQLite (via rusqlite) |
| **Bundler** | Rolldown (Vite 8.2) |
| **Motor Torrent** | librqbit 8.x (vendido) |
| **Runtime Lua** | mlua 0.10 (Lua 5.4, vendido) |
| **Estilos** | Tailwind CSS 4.3 |
| **Instalador** | NSIS (nativo de Tauri v2) |

## Compilación desde el Código Fuente

### Prerrequisitos

- **Rust** 1.77+ (con `cargo`)
- **Node.js** 20.19+ o 22.12+
- **pnpm** (recomendado) o npm
- **WebView2** (incluido con Windows 10/11)

### Configuración

```bash
# Clonar el repositorio
git clone https://github.com/einey/lumaforge.git
cd lumaforge

# Instalar dependencias del frontend
npm install

# Compilar la aplicación Tauri
npm run tauri build

# O ejecutar en modo desarrollo
npm run tauri dev
```

### Comandos de Desarrollo

```bash
# Verificar tipos TypeScript
npx tsc --noEmit

# Compilar solo el frontend (rápido, para linting)
npx vite build

# Verificar código Rust
cargo check

# Ejecutar pruebas Rust
cargo test

# Ejecutar desarrollo completo de Tauri
npm run tauri dev
```

## Estructura del Proyecto

```
LumaForge/
├── src/                          # Frontend (React + TypeScript)
│   ├── components/               # Componentes UI (dashboard, library, store, settings, etc.)
│   ├── context/                  # Contextos React (GameSession, Library, Favorites, Settings)
│   ├── hooks/                    # Hooks personalizados (playtime, media, detección de control)
│   ├── services/                 # Lógica de negocio (game cache, achievements, debrid, metadata)
│   ├── features/                 # Módulos de funciones (modo consola, perfil, debrid, DRM)
│   ├── pages/                    # Páginas de rutas (Home, Library, Store, Settings, Downloads)
│   └── types/                    # Definiciones de tipos TypeScript
├── src-tauri/                    # Backend (Rust + Tauri v2)
│   ├── src/
│   │   ├── commands/             # Manejadores de comandos Tauri (40+ módulos)
│   │   ├── models/               # Modelos de datos y structs
│   │   ├── sqlite_cache/         # Esquema SQLite, migraciones y consultas
│   │   ├── utils/                # Funciones de utilidad (progreso, descarga, extracción)
│   │   └── lua_engine/           # Runtime Lua 5.4 en sandbox
│   ├── nsis/                     # Arte del instalador NSIS (archivos BMP)
│   └── tauri.conf.json           # Configuración de Tauri
├── tools/                        # Herramientas de compilación y generadores de catálogo
├── public/                       # Estáticos (catálogos de datos, índices DRM)
└── lumaforge-extensions/         # Manifiestos de extensiones integradas
```

## Licencia

Este proyecto está licenciado bajo la **GNU General Public License v3.0** — ver el archivo [LICENSE](LICENSE) para más detalles.

Las dependencias de terceros y sus licencias se enumeran en [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
