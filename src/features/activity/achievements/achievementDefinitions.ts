import {
  BookOpen, Library, Archive, Landmark,
  Rocket, Timer, Target, Moon, Sun,
  CheckCircle2, Medal, Swords, Crown,
  Flame, Zap, CalendarDays, Diamond, Star,
  Drama, Palette, Search, Percent, Gamepad2,
  Clock, Heart, Layers, Code, Gauge,
} from "lucide-react";
import type { AchievementDef } from "../types";

export const ACHIEVEMENT_DEFINITIONS: AchievementDef[] = [
  // ── Library ──
  { id: "starter-collection", title: "Starter Collection", titleKey: "launcher_achievements.achievements.starter-collection.title", description: "Add 10 games to your library", descriptionKey: "launcher_achievements.achievements.starter-collection.description", category: "library", rarity: "common", xp: 25, icon: BookOpen },
  { id: "collector", title: "Collector", titleKey: "launcher_achievements.achievements.collector.title", description: "Add 50 games to your library", descriptionKey: "launcher_achievements.achievements.collector.description", category: "library", rarity: "uncommon", xp: 50, icon: Library },
  { id: "hoarder", title: "Hoarder", titleKey: "launcher_achievements.achievements.hoarder.title", description: "Add 200 games to your library", descriptionKey: "launcher_achievements.achievements.hoarder.description", category: "library", rarity: "rare", xp: 100, icon: Archive },
  { id: "archivist", title: "Archivist", titleKey: "launcher_achievements.achievements.archivist.title", description: "Add 500 games to your library", descriptionKey: "launcher_achievements.achievements.archivist.description", category: "library", rarity: "epic", xp: 250, icon: Landmark },

  // ── Play ──
  { id: "first-launch", title: "First Launch", titleKey: "launcher_achievements.achievements.first-launch.title", description: "Launch any game for the first time", descriptionKey: "launcher_achievements.achievements.first-launch.description", category: "play", rarity: "common", xp: 10, icon: Rocket, hidden: true },
  { id: "marathon-runner", title: "Marathon Runner", titleKey: "launcher_achievements.achievements.marathon-runner.title", description: "Complete 5 sessions of 4+ hours", descriptionKey: "launcher_achievements.achievements.marathon-runner.description", category: "play", rarity: "uncommon", xp: 75, icon: Timer },
  { id: "session-master", title: "Session Master", titleKey: "launcher_achievements.achievements.session-master.title", description: "Complete 500 play sessions", descriptionKey: "launcher_achievements.achievements.session-master.description", category: "play", rarity: "rare", xp: 150, icon: Target },
  { id: "night-owl", title: "Night Owl", titleKey: "launcher_achievements.achievements.night-owl.title", description: "End 10 sessions after midnight", descriptionKey: "launcher_achievements.achievements.night-owl.description", category: "play", rarity: "uncommon", xp: 50, icon: Moon },
  { id: "early-bird", title: "Early Bird", titleKey: "launcher_achievements.achievements.early-bird.title", description: "Start 10 sessions before 7 AM", descriptionKey: "launcher_achievements.achievements.early-bird.description", category: "play", rarity: "uncommon", xp: 50, icon: Sun },

  // ── Completion ──
  { id: "finisher", title: "Finisher", titleKey: "launcher_achievements.achievements.finisher.title", description: "Complete your first game", descriptionKey: "launcher_achievements.achievements.finisher.description", category: "completion", rarity: "common", xp: 50, icon: CheckCircle2 },
  { id: "closer", title: "Closer", titleKey: "launcher_achievements.achievements.closer.title", description: "Complete 5 games", descriptionKey: "launcher_achievements.achievements.closer.description", category: "completion", rarity: "uncommon", xp: 100, icon: Medal },
  { id: "backlog-slayer", title: "Backlog Slayer", titleKey: "launcher_achievements.achievements.backlog-slayer.title", description: "Complete 10 games", descriptionKey: "launcher_achievements.achievements.backlog-slayer.description", category: "completion", rarity: "rare", xp: 200, icon: Swords },
  { id: "completionist", title: "Completionist", titleKey: "launcher_achievements.achievements.completionist.title", description: "Complete 25 games", descriptionKey: "launcher_achievements.achievements.completionist.description", category: "completion", rarity: "epic", xp: 350, icon: Crown },

  // ── Streak ──
  { id: "week-warrior", title: "Week Warrior", titleKey: "launcher_achievements.achievements.week-warrior.title", description: "Maintain a 7-day play streak", descriptionKey: "launcher_achievements.achievements.week-warrior.description", category: "streak", rarity: "common", xp: 50, icon: Flame },
  { id: "fortnight-fighter", title: "Fortnight Fighter", titleKey: "launcher_achievements.achievements.fortnight-fighter.title", description: "Maintain a 14-day play streak", descriptionKey: "launcher_achievements.achievements.fortnight-fighter.description", category: "streak", rarity: "uncommon", xp: 75, icon: Zap },
  { id: "monthly-dedication", title: "Monthly Dedication", titleKey: "launcher_achievements.achievements.monthly-dedication.title", description: "Maintain a 30-day play streak", descriptionKey: "launcher_achievements.achievements.monthly-dedication.description", category: "streak", rarity: "rare", xp: 150, icon: CalendarDays },
  { id: "quarterly-commitment", title: "Quarterly Commitment", titleKey: "launcher_achievements.achievements.quarterly-commitment.title", description: "Maintain a 90-day play streak", descriptionKey: "launcher_achievements.achievements.quarterly-commitment.description", category: "streak", rarity: "epic", xp: 300, icon: Diamond },
  { id: "year-of-gaming", title: "Year of Gaming", titleKey: "launcher_achievements.achievements.year-of-gaming.title", description: "Maintain a 365-day play streak", descriptionKey: "launcher_achievements.achievements.year-of-gaming.description", category: "streak", rarity: "legendary", xp: 1000, icon: Star },

  // ── Exploration ──
  { id: "genre-hopper", title: "Genre Hopper", titleKey: "launcher_achievements.achievements.genre-hopper.title", description: "Play 5+ different genres in a month", descriptionKey: "launcher_achievements.achievements.genre-hopper.description", category: "exploration", rarity: "uncommon", xp: 50, icon: Drama },
  { id: "renaissance-gamer", title: "Renaissance Gamer", titleKey: "launcher_achievements.achievements.renaissance-gamer.title", description: "Play 10+ genres all-time", descriptionKey: "launcher_achievements.achievements.renaissance-gamer.description", category: "exploration", rarity: "rare", xp: 100, icon: Palette },
  { id: "hidden-gem-hunter", title: "Hidden Gem Hunter", titleKey: "launcher_achievements.achievements.hidden-gem-hunter.title", description: "Play 10+ games without completing any — exploring, not finishing", descriptionKey: "launcher_achievements.achievements.hidden-gem-hunter.description", category: "exploration", rarity: "rare", xp: 100, icon: Search },

  // ── Session ──
  { id: "session-centurion", title: "Session Centurion", titleKey: "launcher_achievements.achievements.session-centurion.title", description: "Complete 100 play sessions", descriptionKey: "launcher_achievements.achievements.session-centurion.description", category: "session", rarity: "uncommon", xp: 75, icon: Percent },
  { id: "weekend-warrior", title: "Weekend Warrior", titleKey: "launcher_achievements.achievements.weekend-warrior.title", description: "Play on 4 consecutive weekends", descriptionKey: "launcher_achievements.achievements.weekend-warrior.description", category: "session", rarity: "rare", xp: 100, icon: Gamepad2 },

  // ── Fase 2: Play ──
  { id: "century-club", title: "Century Club", titleKey: "launcher_achievements.achievements.century-club.title", description: "Accumulate 100 hours of total playtime", descriptionKey: "launcher_achievements.achievements.century-club.description", category: "play", rarity: "epic", xp: 200, icon: Clock },
  { id: "no-lifer", title: "No-Lifer", titleKey: "launcher_achievements.achievements.no-lifer.title", description: "Accumulate 500 hours of total playtime", descriptionKey: "launcher_achievements.achievements.no-lifer.description", category: "play", rarity: "legendary", xp: 500, icon: Heart },

  // ── Fase 2: Streak ──
  { id: "daily-grinder", title: "Daily Grinder", titleKey: "launcher_achievements.achievements.daily-grinder.title", description: "Maintain a 3-day play streak", descriptionKey: "launcher_achievements.achievements.daily-grinder.description", category: "streak", rarity: "uncommon", xp: 50, icon: Flame },

  // ── Fase 2: Exploration ──
  { id: "multi-platform", title: "Multi-Platform", titleKey: "launcher_achievements.achievements.multi-platform.title", description: "Play games from 3+ different sources", descriptionKey: "launcher_achievements.achievements.multi-platform.description", category: "exploration", rarity: "rare", xp: 100, icon: Layers },
  { id: "lua-enthusiast", title: "Lua Enthusiast", titleKey: "launcher_achievements.achievements.lua-enthusiast.title", description: "Play 5+ games with Lua scripts", descriptionKey: "launcher_achievements.achievements.lua-enthusiast.description", category: "exploration", rarity: "uncommon", xp: 75, icon: Code },

  // ── Fase 2: Session ──
  { id: "speedrunner", title: "Speedrunner", titleKey: "launcher_achievements.achievements.speedrunner.title", description: "Complete 10 sessions under 15 minutes", descriptionKey: "launcher_achievements.achievements.speedrunner.description", category: "session", rarity: "uncommon", xp: 50, icon: Gauge },
  { id: "marathon-master", title: "Marathon Master", titleKey: "launcher_achievements.achievements.marathon-master.title", description: "Complete 20 sessions of 4+ hours", descriptionKey: "launcher_achievements.achievements.marathon-master.description", category: "session", rarity: "rare", xp: 150, icon: Swords },
];

export const TOTAL_XP_AVAILABLE = ACHIEVEMENT_DEFINITIONS.reduce((sum, a) => sum + a.xp, 0);
