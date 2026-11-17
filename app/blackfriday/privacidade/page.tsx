import Link from "next/link";

export const metadata = { title: "Privacidade da campanha | PS Estética" };

export default function BlackFridayPrivacy() {
  return <main style={{ minHeight: "100vh", background: "#11100e", color: "#eee8dd", padding: "48px 22px", fontFamily: "Segoe UI, sans-serif" }}>
    <article style={{ maxWidth: 760, margin: "0 auto", lineHeight: 1.75 }}>
      <p style={{ color: "#c5a75f", letterSpacing: ".16em", textTransform: "uppercase", fontSize: 12 }}>PS Estética · Black Friday</p>
      <h1 style={{ fontFamily: "Georgia, serif", fontWeight: 400, fontSize: "clamp(34px, 7vw, 54px)", lineHeight: 1.1 }}>Privacidade da campanha</h1>
      <p>Ao visitar a página, podemos registrar parâmetros da campanha, como UTMs e identificadores fornecidos pela Meta, para entender a origem das visitas. Esses dados são mantidos por até 30 dias.</p>
      <p>O clique no convite do WhatsApp não é tratado como Lead. Quando uma nova entrada no grupo é confirmada, o número recebido pelo WhatsApp é transformado em um código criptográfico irreversível (SHA-256) e pode ser enviado à Meta para mensuração da campanha. O número em texto não é enviado por esse processo. Esse código é removido do nosso banco após 90 dias.</p>
      <p>A entrada confirmada é registrada sem associação presumida a uma visita ou anúncio. A atribuição final depende dos mecanismos da própria Meta.</p>
      <p>Você pode sair do grupo quando quiser e solicitar informações, correção ou exclusão dos seus dados entrando em contato com a PS Estética.</p>
      <Link href="/blackfriday" style={{ display: "inline-block", marginTop: 20, color: "#d5b96f", textUnderlineOffset: 4 }}>Voltar para a Black Friday</Link>
    </article>
  </main>;
}
