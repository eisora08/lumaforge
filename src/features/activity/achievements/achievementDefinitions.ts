import {
  BookOpen, Library, Archive, Landmark,
  Rocket, Timer, Target, Moon, Sun,
  CheckCircle2, Medal, Swords, Crown,
  Flame, Zap, CalendarDays, Diamond, Star,
  Drama, Palette, Search, Percent, Gamepad2,
} from "lucide-react";
import type { AchievementDef } from "../types";

export const ACHIEVEMENT_DEFINITIONS: AchievementDef[] = [
  // ── Library ──
  { id: "starter-collection", title: "Starter Collection", description: "Add 10 games to your library", category: "library", rarity: "common", xp: 25, icon: BookOpen },
  { id: "collector", title: "Collector", description: "Add 50 games to your library", category: "library", rarity: "uncommon", xp: 50, icon: Library },
  { id: "hoarder", title: "Hoarder", description: "Add 200 games to your library", category: "library", rarity: "rare", xp: 100, icon: Archive },
  { id: "archivist", title: "Archivist", description: "Add 500 games to your library", category: "library", rarity: "epic", xp: 250, icon: Landmark },

  // ── Play ──
  { id: "first-launch", title: "First Launch", description: "Launch any game for the first time", category: "play", rarity: "common", xp: 10, icon: Rocket, hidden: true },
  { id: "marathon-runner", title: "Marathon Runner", description: "Complete 5 sessions of 4+ hours", category: "play", rarity: "uncommon", xp: 75, icon: Timer },
  { id: "session-master", title: "Session Master", description: "Complete 500 play sessions", category: "play", rarity: "rare", xp: 150, icon: Target },
  { id: "night-owl", title: "Night Owl", description: "End 10 sessions after midnight", category: "play", rarity: "uncommon", xp: 50, icon: Moon },
  { id: "early-bird", title: "Early Bird", description: "Start 10 sessions before 7 AM", category: "play", rarity: "uncommon", xp: 50, icon: Sun },

  // ── Completion ──
  { id: "finisher", title: "Finisher", description: "Complete your first game", category: "completion", rarity: "common", xp: 50, icon: CheckCircle2 },
  { id: "closer", title: "Closer", description: "Complete 5 games", category: "completion", rarity: "uncommon", xp: 100, icon: Medal },
  { id: "backlog-slayer", title: "Backlog Slayer", description: "Complete 10 games", category: "completion", rarity: "rare", xp: 200, icon: Swords },
  { id: "completionist", title: "Completionist", description: "Complete 25 games", category: "completion", rarity: "epic", xp: 350, icon: Crown },

  // ── Streak ──
  { id: "week-warrior", title: "Week Warrior", description: "Maintain a 7-day play streak", category: "streak", rarity: "common", xp: 50, icon: Flame },
  { id: "fortnight-fighter", title: "Fortnight Fighter", description: "Maintain a 14-day play streak", category: "streak", rarity: "uncommon", xp: 75, icon: Zap },
  { id: "monthly-dedication", title: "Monthly Dedication", description: "Maintain a 30-day play streak", category: "streak", rarity: "rare", xp: 150, icon: CalendarDays },
  { id: "quarterly-commitment", title: "Quarterly Commitment", description: "Maintain a 90-day play streak", category: "streak", rarity: "epic", xp: 300, icon: Diamond },
  { id: "year-of-gaming", title: "Year of Gaming", description: "Maintain a 365-day play streak", category: "streak", rarity: "legendary", xp: 1000, icon: Star },

  // ── Exploration ──
  { id: "genre-hopper", title: "Genre Hopper", description: "Play 5+ different genres in a month", category: "exploration", rarity: "uncommon", xp: 50, icon: Drama },
  { id: "renaissance-gamer", title: "Renaissance Gamer", description: "Play 10+ genres all-time", category: "exploration", rarity: "rare", xp: 100, icon: Palette },
  { id: "hidden-gem-hunter", title: "Hidden Gem Hunter", description: "Play 3 underrated games for 5+ hours each", category: "exploration", rarity: "rare", xp: 100, icon: Search },

  // ── Session ──
  { id: "session-centurion", title: "Session Centurion", description: "Complete 100 play sessions", category: "session", rarity: "uncommon", xp: 75, icon: Percent },
  { id: "weekend-warrior", title: "Weekend Warrior", description: "Play on 4 consecutive weekends", category: "session", rarity: "rare", xp: 100, icon: Gamepad2 },
];

export const TOTAL_XP_AVAILABLE = ACHIEVEMENT_DEFINITIONS.reduce((sum, a) => sum + a.xp, 0);
