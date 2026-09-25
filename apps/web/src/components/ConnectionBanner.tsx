import { useEffect, useState, type ReactNode } from "react";
import { onConnectChange } from "../lib/socket";
import { useSession } from "../lib/session";

export function ConnectionBanner(): ReactNode {
  const [connected, setConnected] = useState(true);
  const [everConnected, setEverConnected] = useState(false);
  const { user } = useSession();

  useEffect(() => {
    return onConnectChange((c) => {
      setConnected(c);
      if (c) setEverConnected(true);
    });
  }, []);

  if (!user || connected || (everConnected && connected)) return null;
  if (!user || connected) return null;

  return (
    <div className="conn-banner" role="status">
      Connection lost — reconnecting… your progress is safe on the server.
    </div>
  );
}
