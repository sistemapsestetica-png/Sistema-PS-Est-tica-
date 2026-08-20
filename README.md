# PS Estética

Site, quiz, agenda online, painel master da recepção e portal individual dos profissionais.

## Fluxos disponíveis

- `/` — quiz com escolha de horário e geração automática do Pix.
- `/agendar` — agenda direta para a recepção enviar sem o quiz.
- `/admin` — agenda master, preços, horários, equipe, links e pagamentos.
- `/profissional` — acesso individual à agenda e aos atendimentos atribuídos.

O sinal é calculado pelo percentual salvo no serviço (10% por padrão). A vaga fica temporariamente reservada, o Mercado Pago gera o Pix e o webhook confirma o agendamento automaticamente.

## Desenvolvimento

1. Copie `.env.example` para `.env.local`.
2. Preencha as variáveis públicas do Supabase.
3. Informe o ID do Meta Pixel em `NEXT_PUBLIC_META_PIXEL_ID`.
4. Execute `npm install` e `npm run dev`.

O Pixel dispara `PageView`, `Lead`, `InitiateCheckout` e `Purchase` no navegador. Para confirmar a compra também pelo servidor, configure `META_CONVERSIONS_API_TOKEN` nos secrets do Supabase. O token nunca deve ser salvo em `.env` público ou enviado ao GitHub.

## Configuração do Mercado Pago

Depois do deploy da migração e das Edge Functions, cadastre estes secrets no projeto Supabase:

```bash
supabase secrets set \
  MERCADO_PAGO_ACCESS_TOKEN="APP_USR-..." \
  MERCADO_PAGO_WEBHOOK_SECRET="..." \
  MERCADO_PAGO_WEBHOOK_URL="https://tprouhszfoofljcebtsd.supabase.co/functions/v1/mercado-pago-webhook" \
  SITE_URL="https://ps-estetica-sbc.vercel.app"
```

Para enviar a confirmação de pré-reserva por e-mail, configure também o Resend nos secrets das Edge Functions:

```bash
supabase secrets set \
  RESEND_API_KEY="re_..." \
  RESEND_FROM_EMAIL="PS Estética <agendamentos@notificacoes.psestetica.com.br>" \
  RESEND_REPLY_TO="contato@psestetica.com.br"
```

O domínio do endereço remetente precisa estar validado no Resend. O envio usa uma chave de idempotência por reserva para evitar mensagens duplicadas.

No painel do Mercado Pago, configure o webhook de pagamentos para:

```text
https://tprouhszfoofljcebtsd.supabase.co/functions/v1/mercado-pago-webhook
```

O indicador “Mercado Pago ativo” é habilitado automaticamente assim que o primeiro Pix for gerado com sucesso.

As credenciais do Mercado Pago ficam somente nos secrets das Edge Functions. Elas nunca são expostas ao navegador ou ao repositório.
