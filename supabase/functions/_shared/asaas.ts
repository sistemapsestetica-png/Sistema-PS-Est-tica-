const DEFAULT_ASAAS_API_URL = "https://api.asaas.com/v3";

export type AsaasCustomerInput = {
  leadId: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  cpf: string;
};

export function cpfDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "").slice(0, 11);
}

export function validCpf(value: unknown) {
  const cpf = cpfDigits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (size: number) => {
    let sum = 0;
    for (let index = 0; index < size; index += 1) sum += Number(cpf[index]) * (size + 1 - index);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

function apiUrl() {
  return (Deno.env.get("ASAAS_API_URL") ?? DEFAULT_ASAAS_API_URL).replace(/\/$/, "");
}

export function isAsaasConfigured() {
  return Boolean(Deno.env.get("ASAAS_API_KEY"));
}

export async function asaasFetch(path: string, init: RequestInit = {}) {
  const key = Deno.env.get("ASAAS_API_KEY");
  if (!key) throw new Error("ASAAS_API_KEY is not configured");
  const response = await fetch(`${apiUrl()}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      access_token: key,
      "content-type": "application/json",
      "user-agent": "PS-Estetica/1.0",
      ...(init.headers ?? {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const descriptions = Array.isArray(data?.errors)
      ? data.errors.map((error: { description?: string }) => error.description).filter(Boolean).join("; ")
      : "";
    throw new Error(`Asaas ${response.status}${descriptions ? `: ${descriptions}` : ""}`);
  }
  return data;
}

export async function getOrCreateAsaasCustomer(input: AsaasCustomerInput) {
  const externalReference = `lead:${input.leadId}`;
  const query = new URLSearchParams({ externalReference, cpfCnpj: input.cpf, limit: "1" });
  const existing = await asaasFetch(`/customers?${query.toString()}`);
  if (Array.isArray(existing?.data) && existing.data[0]?.id) return existing.data[0];

  return await asaasFetch("/customers", {
    method: "POST",
    body: JSON.stringify({
      name: input.name.trim() || "Cliente PS Estetica",
      cpfCnpj: input.cpf,
      email: input.email?.trim() || undefined,
      mobilePhone: String(input.phone ?? "").replace(/\D/g, "") || undefined,
      externalReference,
      notificationDisabled: true,
    }),
  });
}

export function asaasDueDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

export function secureEquals(actual: string, expected: string) {
  if (!actual || actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}
