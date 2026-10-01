import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type { Dashboard, User } from "./types";

/** Horloge locale, rafraîchie chaque seconde (ou selon `interval`). */
export function useNow(interval = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(t);
  }, [interval]);
  return now;
}

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<{ user: User }>("/auth/me").then((r) => r.user),
    retry: false,
    staleTime: 60_000,
  });
}

export function useUser(): User {
  const { data } = useMe();
  if (!data) throw new Error("useUser hors session");
  return data;
}

export function useDashboard() {
  return useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<Dashboard>("/dashboard"), refetchInterval: 60_000 });
}

export type ClockAction = "start" | "stop" | "break/start" | "break/end";

export function useClock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (action: ClockAction) => api.post<Dashboard>(`/clock/${action}`),
    onSuccess: (d) => {
      qc.setQueryData(["dashboard"], d);
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "dashboard" && q.queryKey[0] !== "me" });
      if ("vibrate" in navigator) navigator.vibrate?.(15);
    },
  });
}

/** Invalide toutes les données calculées après une modification. */
export function useInvalidateData() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "me" });
}
