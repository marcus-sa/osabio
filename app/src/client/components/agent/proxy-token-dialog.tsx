import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../ui/dialog";
import { Button } from "../ui/button";

type ProxyTokenDialogProps = {
  open: boolean;
  token: string;
  agentName: string;
  onClose: () => void;
};

export function ProxyTokenDialog({ open, token, agentName, onClose }: ProxyTokenDialogProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Proxy Token for {agentName}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            This token is shown only once. Copy it now and store it securely. It will be used as the <code className="rounded bg-muted px-1">X-Osabio-Auth</code> header value for this agent's API requests.
          </p>
          <div className="flex items-center gap-2">
            <code
              className="flex-1 overflow-x-auto rounded-md border border-border bg-muted p-2 text-xs"
              data-testid="proxy-token-value"
            >
              {token}
            </code>
            <Button variant="outline" size="xs" onClick={handleCopy}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="default" size="sm" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
