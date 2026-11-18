// Validação do e-mail do quiz do Laser Day (além do type="email" do navegador, que aceita "usuario.@gmail.com").
export const INVALID_EMAIL_MESSAGE = "Confira o e-mail. Exemplo: nome@gmail.com";

const localPart = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/i; // sem ponto no início/fim e sem ".."
const domainLabel = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string) {
  const email = normalizeEmail(value);
  if (email.length > 254) return false;
  const at = email.lastIndexOf("@");
  if (at <= 0 || at !== email.indexOf("@")) return false; // exatamente um "@", com algo antes
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length > 64 || !localPart.test(local)) return false;
  const labels = domain.split(".");
  if (labels.length < 2) return false; // domínio precisa de ponto (gmail.com, não "gmail")
  if (!labels.every((label) => domainLabel.test(label))) return false; // rejeita "..", ponto no início/fim
  return /^[a-z]{2,}$/i.test(labels[labels.length - 1]); // final com letras: .com, .br
}
