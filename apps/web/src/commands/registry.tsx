/**
 * Command registry (F199): pages contribute commands to the global ⌘K
 * palette while mounted (note operations, view toggles, …).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import type { PaletteCommand } from '@fables/ui';

type Register = (commands: PaletteCommand[]) => () => void;

const CommandsContext = createContext<PaletteCommand[]>([]);
const RegisterContext = createContext<Register | null>(null);

export function CommandRegistryProvider({ children }: { children: ReactNode }) {
  const [sets, setSets] = useState<PaletteCommand[][]>([]);

  const register = useCallback<Register>((commands) => {
    setSets((prev) => [...prev, commands]);
    return () => setSets((prev) => prev.filter((s) => s !== commands));
  }, []);

  const commands = useMemo(() => sets.flat(), [sets]);

  return (
    <RegisterContext.Provider value={register}>
      <CommandsContext.Provider value={commands}>{children}</CommandsContext.Provider>
    </RegisterContext.Provider>
  );
}

export function useRegisteredCommands(): PaletteCommand[] {
  return useContext(CommandsContext);
}

/** Register `commands` for the lifetime of the calling component. */
export function useRegisterCommands(commands: PaletteCommand[]): void {
  const register = useContext(RegisterContext);
  // Commands close over fresh state every render; register stable proxies
  // once (per id-set) that always dispatch to the latest closures.
  const latest = useRef(commands);
  latest.current = commands;
  const ids = commands.map((c) => c.id).join(' ');

  useEffect(() => {
    if (!register) return;
    const proxies: PaletteCommand[] = latest.current.map((cmd, i) => ({
      ...cmd,
      run: () => latest.current[i]?.run(),
    }));
    return register(proxies);
  }, [register, ids]);
}
