function normalizeUrl(value: string | undefined, fallback: string) {
  return (value?.trim() || fallback).replace(/\/$/, "");
}

export const QUIZ_URL = normalizeUrl(
  process.env.NEXT_PUBLIC_QUIZ_URL,
  "https://quiz.psestetica.com.br",
);

export const AGENDA_URL = normalizeUrl(
  process.env.NEXT_PUBLIC_AGENDA_URL,
  "https://agenda.psestetica.com.br",
);

export const PANEL_URL = normalizeUrl(
  process.env.NEXT_PUBLIC_PANEL_URL,
  "https://painel.psestetica.com.br",
);

export const PROFESSIONAL_URL = normalizeUrl(
  process.env.NEXT_PUBLIC_PROFESSIONAL_URL,
  "https://profissional.psestetica.com.br",
);
