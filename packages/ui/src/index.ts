export { ThemeProvider, useTheme, type Theme } from './theme.js';
export { Button, Input, Textarea, Select, Dialog, Tooltip } from './primitives.js';
export { ToastProvider, useToast } from './toast.js';
export { CommandPalette, filterCommands, fuzzyMatch, type PaletteCommand } from './palette.js';
// Icons: single import point so the app stays consistent (F076)
export {
  BookOpen,
  FileText,
  Network,
  CalendarDays,
  Search,
  Settings,
  Settings2,
  Moon,
  Sun,
  Plus,
  X,
  Check,
  ChevronRight,
  // Markdown editor toolbar + preview (Day 2, F123/F138/F139)
  Bold,
  Italic,
  Heading,
  List,
  ListOrdered,
  Code,
  Quote,
  Link2,
  ImagePlus,
  Eye,
  Pencil,
  Columns2,
  WrapText,
  TableOfContents as TocIcon,
} from 'lucide-react';
