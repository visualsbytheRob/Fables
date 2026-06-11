import { useState } from 'react';
import {
  Button,
  Dialog,
  Input,
  Select,
  Textarea,
  Tooltip,
  useTheme,
  useToast,
} from '@fables/ui';

/** Visual QA: every UI primitive on one page (F080). */
export function PlaygroundPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();

  return (
    <div className="ui-stack" style={{ maxWidth: 560 }}>
      <h1>Playground</h1>

      <h3>Buttons</h3>
      <div className="ui-row">
        <Button>Default</Button>
        <Button variant="primary">Primary</Button>
        <Button variant="danger">Danger</Button>
        <Button disabled>Disabled</Button>
      </div>

      <h3>Inputs</h3>
      <Input placeholder="Text input" />
      <Textarea placeholder="Textarea" />
      <Select defaultValue="fox">
        <option value="fox">The Fox</option>
        <option value="crow">The Crow</option>
        <option value="lion">The Lion</option>
      </Select>

      <h3>Theme ({theme})</h3>
      <div className="ui-row">
        <Button onClick={() => setTheme('dark')}>Dark</Button>
        <Button onClick={() => setTheme('light')}>Light</Button>
        <Button onClick={() => setTheme('system')}>System</Button>
      </div>

      <h3>Overlays</h3>
      <div className="ui-row">
        <Button onClick={() => setDialogOpen(true)}>Open dialog</Button>
        <Button onClick={() => toast('Saved successfully')}>Info toast</Button>
        <Button onClick={() => toast('Something failed', 'error')}>Error toast</Button>
        <Tooltip label="Tooltips use native titles for now">
          <Button>Hover me</Button>
        </Tooltip>
      </div>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)}>
        <h2 style={{ marginTop: 0 }}>A modal fable</h2>
        <p>Native dialog element: focus-trapped, Escape to close.</p>
        <Button variant="primary" onClick={() => setDialogOpen(false)}>
          Close
        </Button>
      </Dialog>

      <p style={{ color: 'var(--text-dim)' }}>Press ⌘K / Ctrl+K for the command palette.</p>
    </div>
  );
}
