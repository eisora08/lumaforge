// import { useState, useEffect } from "react";
// import { useBackButtonContext } from "../../context/BackButtonContext";
// import {
//   Database,
//   Download,
//   ExternalLink,
//   FileCode2,
//   FolderOpen,
//   Gamepad2,
//   Play,
//   Power,
//   RefreshCcw,
//   ShieldCheck,
//   ShieldOff,
//   Trash2,
// } from "lucide-react";

// import type { InstalledLibraryGame } from "../../types/installedLibrary";

// type InstalledGameDetailsProps = {
//   game: InstalledLibraryGame;
//   onPlay: (game: InstalledLibraryGame) => void;
//   onInstallSteam: (game: InstalledLibraryGame) => void;
//   onSync: (game: InstalledLibraryGame) => void;
//   onToggle: (game: InstalledLibraryGame) => void;
//   onDelete: (game: InstalledLibraryGame) => void;
//   onOpenSteam: (game: InstalledLibraryGame) => void;
//   onOpenSteamDb: (game: InstalledLibraryGame) => void;
//   onOpenSourceSelector: (game: InstalledLibraryGame) => void;
//   onBack: () => void;
// };

// function getImageUrl(game: InstalledLibraryGame): string | undefined {
//   return (
//     game.imageUrl ||
//     game.metadata?.header_image ||
//     game.metadata?.capsule_image ||
//     game.metadata?.capsule_image_v5 ||
//     undefined
//   );
// }

// function formatDate(seconds: number) {
//   if (!seconds) return "No disponible";
//   return new Date(seconds * 1000).toLocaleDateString();
// }

// function formatBytes(bytes: number) {
//   if (!bytes) return "0 B";
//   const units = ["B", "KB", "MB", "GB"];
//   let size = bytes;
//   let unitIndex = 0;
//   while (size >= 1024 && unitIndex < units.length - 1) {
//     size /= 1024;
//     unitIndex += 1;
//   }
//   return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
// }

// export default function InstalledGameDetails({
//   game,
//   onPlay,
//   onSync,
//   onToggle,
//   onDelete,
//   onOpenSteam,
//   onOpenSteamDb,
//   onOpenSourceSelector,
//   onBack,
// }: InstalledGameDetailsProps) {
//   const [imageFailed, setImageFailed] = useState(false);
//   const imageUrl = getImageUrl(game);
//   const script = game.luaScripts[0];
//   const status = game.installStatus;

//   // Set back button in TopBar
//   const { setBackButton } = useBackButtonContext();
//   useEffect(() => {
//     setBackButton({ onBack, label: "Back to Library" });
//     return () => setBackButton(null);
//   }, [onBack]);
//   const isActive = status === "active";
//   const isDisabled = status === "disabled";

//   return (
//     <div className="flex h-full flex-col overflow-y-auto">
//       {/* Back button handled by TopBar via BackButtonContext */}

//       {/* Hero image */}
//       <div className="relative h-48 shrink-0 overflow-hidden bg-white/5 lg:h-64">
//         {imageUrl && !imageFailed ? (
//           <img
//             src={imageUrl}
//             alt={game.title}
//             className="h-full w-full object-cover"
//             onError={() => setImageFailed(true)}
//           />
//         ) : (
//           <div className="flex h-full w-full items-center justify-center bg-linear-to-br from-white/10 via-white/5 to-black/50">
//             <Gamepad2 className="h-16 w-16 text-(--color-muted)" />
//           </div>
//         )}
//         <div className="absolute inset-0 bg-linear-to-t from-black/90 via-black/40 to-transparent" />

//         <div className="absolute bottom-0 left-0 right-0 p-5 lg:p-7">
//           <div className="mb-3 flex flex-wrap items-center gap-2">
//             {isActive && (
//               <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
//                 <ShieldCheck className="h-3.5 w-3.5" />
//                 Installed
//               </span>
//             )}
//             {isDisabled && (
//               <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-500/20 bg-zinc-500/10 px-3 py-1 text-xs text-zinc-300">
//                 <ShieldOff className="h-3.5 w-3.5" />
//                 Disabled
//               </span>
//             )}
//             {game.hasLuaInstalled && (
//               <span className="inline-flex items-center gap-1.5 rounded-full border border-(--color-accent)/20 bg-(--color-accent)/10 px-3 py-1 text-xs text-(--color-accent)">
//                 <FileCode2 className="h-3.5 w-3.5" />
//                 Lua Installed
//               </span>
//             )}
//             {game.hasAvailableSource && (
//               <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
//                 <Download className="h-3.5 w-3.5" />
//                 Lua Ready
//               </span>
//             )}
//             {game.hasUpdate && (
//               <span className="inline-flex items-center gap-1.5 rounded-full border border-yellow-500/20 bg-yellow-500/10 px-3 py-1 text-xs text-yellow-300">
//                 <RefreshCcw className="h-3.5 w-3.5" />
//                 Update Available
//               </span>
//             )}
//           </div>

//           <h1 className="line-clamp-1 text-2xl font-black text-white lg:text-3xl">
//             {game.title}
//           </h1>

//           {game.developer && (
//             <p className="mt-1 text-sm text-white/70">{game.developer}</p>
//           )}
//         </div>
//       </div>

//       {/* Content */}
//       <div className="flex-1 space-y-6 p-5 lg:p-7">
//         {/* Main actions */}
//         <div className="flex flex-wrap gap-2">
//           <button
//             type="button"
//             onClick={() => onPlay(game)}
//             className="inline-flex items-center gap-2 rounded-xl bg-(--color-accent) px-5 py-2.5 text-sm font-bold text-(--color-accent-text) transition hover:opacity-90"
//           >
//             <Play className="h-4 w-4" />
//             Play
//           </button>

//           {game.hasAvailableSource && (
//             <button
//               type="button"
//               onClick={() => onSync(game)}
//               className="inline-flex items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2.5 text-sm font-medium text-(--color-text) transition hover:bg-white/10"
//             >
//               <RefreshCcw className="h-4 w-4" />
//               Sync Lua
//             </button>
//           )}

//           <button
//             type="button"
//             onClick={() => onOpenSourceSelector(game)}
//             className="inline-flex items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2.5 text-sm font-medium text-(--color-text) transition hover:bg-white/10"
//           >
//             <Download className="h-4 w-4" />
//             Manage Source
//           </button>

//           <button
//             type="button"
//             onClick={() => onOpenSteam(game)}
//             className="inline-flex items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2.5 text-sm font-medium text-(--color-text) transition hover:bg-white/10"
//           >
//             <ExternalLink className="h-4 w-4" />
//             Open Steam
//           </button>
//         </div>

//         {/* Secondary actions */}
//         <div className="flex flex-wrap gap-2">
//           {script && (
//             <button
//               type="button"
//               onClick={() => onToggle(game)}
//               className="inline-flex items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
//             >
//               <Power className="h-3.5 w-3.5" />
//               {isDisabled ? "Enable Lua" : "Disable Lua"}
//             </button>
//           )}

//           <button
//             type="button"
//             onClick={() => onOpenSteamDb(game)}
//             className="inline-flex items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
//           >
//             <Database className="h-3.5 w-3.5" />
//             Open SteamDB
//           </button>

//           {script && (
//             <button
//               type="button"
//               onClick={() => onDelete(game)}
//               className="inline-flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300 transition hover:bg-red-500/15"
//             >
//               <Trash2 className="h-3.5 w-3.5" />
//               Delete Lua
//             </button>
//           )}
//         </div>

//         {/* Info sections */}
//         <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
//           Activity section
//           <section className="rounded-2xl border border-(--surface-active-border) bg-white/[0.02] p-4">
//             <h3 className="flex items-center gap-2 font-semibold text-(--color-text)">
//               <Gamepad2 className="h-4 w-4 text-(--color-accent)" />
//               Activity
//             </h3>
//             <div className="mt-4 space-y-3">
//               <div className="rounded-xl border border-(--surface-active-border) bg-white/5 p-3">
//                 <p className="text-xs text-(--color-muted)">Playtime</p>
//                 <p className="mt-1 text-sm text-(--color-text)">
//                   Playtime tracking is not available yet.
//                 </p>
//               </div>

//               {script && (
//                 <div className="rounded-xl border border-(--surface-active-border) bg-white/5 p-3">
//                   <p className="text-xs text-(--color-muted)">Last Modified</p>
//                   <p className="mt-1 text-sm text-(--color-text)">
//                     {formatDate(script.modified_at)}
//                   </p>
//                 </div>
//               )}
//             </div>
//           </section>

//           {/* Lua / Manifest Status */}
//           <section className="rounded-2xl border border-(--surface-active-border) bg-white/[0.02] p-4">
//             <h3 className="flex items-center gap-2 font-semibold text-(--color-text)">
//               <FileCode2 className="h-4 w-4 text-(--color-accent)" />
//               Lua / Manifest Status
//             </h3>
//             <div className="mt-4 space-y-3">
//               {script ? (
//                 <>
//                   <div className="rounded-xl border border-(--surface-active-border) bg-white/5 p-3">
//                     <p className="text-xs text-(--color-muted)">Script File</p>
//                     <p className="mt-1 break-all text-sm font-medium text-(--color-text)">
//                       {script.file_name}
//                     </p>
//                   </div>

//                   <div className="grid grid-cols-2 gap-3">
//                     <div className="rounded-xl border border-(--surface-active-border) bg-white/5 p-3">
//                       <p className="text-xs text-(--color-muted)">Size</p>
//                       <p className="mt-1 text-sm text-(--color-text)">
//                         {formatBytes(script.file_size)}
//                       </p>
//                     </div>

//                     <div className="rounded-xl border border-(--surface-active-border) bg-white/5 p-3">
//                       <p className="text-xs text-(--color-muted)">Status</p>
//                       <p className="mt-1 text-sm text-(--color-text)">
//                         {isActive ? "Active" : "Disabled"}
//                       </p>
//                     </div>
//                   </div>

//                   <div className="rounded-xl border border-(--surface-active-border) bg-white/5 p-3">
//                     <p className="text-xs text-(--color-muted)">Path</p>
//                     <p className="mt-1 break-all text-sm text-(--color-text)">
//                       {script.path}
//                     </p>
//                   </div>
//                 </>
//               ) : (
//                 <div className="rounded-xl border border-(--surface-active-border) bg-white/5 p-3">
//                   <p className="text-sm text-(--color-muted)">
//                     No Lua script installed.
//                   </p>
//                 </div>
//               )}
//             </div>
//           </section>

//           {/* Updates section */}
//           <section className="rounded-2xl border border-(--surface-active-border) bg-white/[0.02] p-4">
//             <h3 className="flex items-center gap-2 font-semibold text-(--color-text)">
//               <RefreshCcw className="h-4 w-4 text-(--color-accent)" />
//               Updates
//             </h3>
//             <div className="mt-4 space-y-3">
//               <div className="rounded-xl border border-(--surface-active-border) bg-white/5 p-3">
//                 <p className="text-xs text-(--color-muted)">Sync Status</p>
//                 <p className="mt-1 text-sm text-(--color-text)">
//                   {game.updateInfo?.label || "Not checked"}
//                 </p>
//                 {game.updateInfo?.description && (
//                   <p className="mt-1 text-xs text-(--color-muted)">
//                     {game.updateInfo.description}
//                   </p>
//                 )}
//               </div>

//               {game.updateInfo?.lastCheckedAt && (
//                 <div className="rounded-xl border border-(--surface-active-border) bg-white/5 p-3">
//                   <p className="text-xs text-(--color-muted)">Last Checked</p>
//                   <p className="mt-1 text-sm text-(--color-text)">
//                     {game.updateInfo.lastCheckedAt}
//                   </p>
//                 </div>
//               )}
//             </div>
//           </section>

//           {/* Provider Source */}
//           <section className="rounded-2xl border border-(--surface-active-border) bg-white/[0.02] p-4">
//             <h3 className="flex items-center gap-2 font-semibold text-(--color-text)">
//               <Download className="h-4 w-4 text-(--color-accent)" />
//               Provider Source
//             </h3>
//             <div className="mt-4 space-y-3">
//               {game.sources.length > 0 ? (
//                 game.sources.map((source, i) => (
//                   <div
//                     key={i}
//                     className="rounded-xl border border-(--surface-active-border) bg-white/5 p-3"
//                   >
//                     <p className="text-xs text-(--color-muted)">{source.providerName}</p>
//                     <p className="mt-1 text-sm text-(--color-text)">
//                       {source.fileType}
//                       {source.available ? " · Available" : " · Unavailable"}
//                     </p>
//                     {source.lastUpdated && (
//                       <p className="mt-0.5 text-xs text-(--color-muted)">
//                         Updated: {source.lastUpdated}
//                       </p>
//                     )}
//                   </div>
//                 ))
//               ) : (
//                 <div className="rounded-xl border border-(--surface-active-border) bg-white/5 p-3">
//                   <p className="text-sm text-(--color-muted)">
//                     No provider sources configured.
//                   </p>
//                 </div>
//               )}

//               <button
//                 type="button"
//                 onClick={() => onOpenSourceSelector(game)}
//                 className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
//               >
//                 <FolderOpen className="h-3.5 w-3.5" />
//                 Manage Source
//               </button>
//             </div>
//           </section>
//         </div>
//       </div>
//     </div>
//   );
// }
