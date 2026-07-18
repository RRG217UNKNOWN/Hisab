import { useCallback, useEffect, useState } from "react";

const KEY = "hisab.colorblindMode";

function readInitial(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

// A display-only preference (like language), not account data — kept in
// localStorage on this device rather than in the profile, and applied by
// toggling a `.colorblind` class on <html> that swaps the red/green
// success/destructive/warning tokens for a blue/orange/amber triad (see
// styles.css).
export function useColorblindMode() {
  const [enabled, setEnabledState] = useState<boolean>(readInitial);

  useEffect(() => {
    document.documentElement.classList.toggle("colorblind", enabled);
  }, [enabled]);

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    try {
      window.localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      // localStorage unavailable (private browsing etc.) — setting still
      // applies for this session via the class toggle above.
    }
  }, []);

  return { enabled, setEnabled };
}
