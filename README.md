# PS Estética

Site, quiz, agenda online, painel master da recepção e portal individual dos profissionais.

## Fluxos disponíveis

- `/` — quiz com escolha de horário e geração automática do Pix.
- `/agendar` — agenda direta para a recepção enviar sem o quiz.
- `/admin` — agenda master, preços, horários, equipe, links e pagamentos.
- `/profissional` — acesso individual à agenda e aos atendimentos atribuídos.

O sinal segue a estratégia híbrida: 10% do procedimento, com mínimo de R$ 30 e máximo de R$ 100. A vaga fica temporariamente reservada, o Mercado Pago gera o Pix e o webhook confirma o agendamento automaticamente.

## Desenvolvimento

1. Copie `.env.example` para `.env.local`.
2. Preencha as variáveis públicas do Supabase.
3. Informe o ID do Meta Pixel em `NEXT_PUBLIC_META_PIXEL_ID`.
4. Execute `npm install` e `npm run dev`.

O Pixel dispara `PageView`, `Lead`, `Schedule`, `InitiateCheckout` e `Purchase` no navegador. A compra também é confirmada pelo servidor via API de Conversões, com deduplicação pelo identificador da reserva. O token nunca deve ser salvo em `.env` público ou enviado ao GitHub.

## Configuração do Mercado Pago

As URLs da operação já podem ficar cadastradas no Supabase antes das credenciais:

```bash
supabase secrets set \
  MERCADO_PAGO_WEBHOOK_URL="https://tprouhszfoofljcebtsd.supabase.co/functions/v1/mercado-pago-webhook" \
  SITE_URL="https://quiz.psestetica.com.br" \
  AGENDA_URL="https://agenda.psestetica.com.br" \
  PANEL_URL="https://painel.psestetica.com.br" \
  PUBLIC_ALLOWED_ORIGINS="https://quiz.psestetica.com.br,https://agenda.psestetica.com.br"
```

Para ativar o Mercado Pago faltam somente duas credenciais, que devem ser mantidas exclusivamente nos secrets das Edge Functions:

```bash
supabase secrets set \
  MERCADO_PAGO_ACCESS_TOKEN="APP_USR-..." \
  MERCADO_PAGO_WEBHOOK_SECRET="assinatura-secreta-do-webhook"
```

Depois disso, publique novamente `create-pix`, `create-service-payment` e `mercado-pago-webhook`. O sistema rejeita notificações sem assinatura válida, confere o valor recebido contra o lançamento esperado e processa cada aprovação apenas uma vez.

Para enviar os e-mails transacionais de pré-reserva e pagamento confirmado ao cliente e ao profissional responsável, configure também o Resend nos secrets das Edge Functions:

```bash
supabase secrets set \
  RESEND_API_KEY="re_..." \
  RESEND_FROM_EMAIL="PS Estética <agendamentos@notificacoes.psestetica.com.br>" \
  RESEND_REPLY_TO="contato@psestetica.com.br"
```

O domínio do endereço remetente precisa estar validado no Resend. Cada uma das quatro mensagens usa uma chave de idempotência própria por reserva para evitar duplicidade:

- pré-reserva recebida pelo cliente;
- nova pré-reserva para o profissional;
- pagamento e horário confirmados para o cliente;
- atendimento confirmado para o profissional.

Os e-mails de autenticação (confirmação de cadastro, convite, recuperação, magic link, alteração de e-mail e reautenticação) usam o SMTP e os templates declarados em `supabase/config.toml` e `supabase/templates`.

## Faturamento integral

O painel da recepção possui um módulo de faturamento que combina o sinal registrado em `payments` com os saldos registrados em `service_payments`. O saldo pode ser recebido de duas formas:

- link autenticado do Mercado Pago, atualizado automaticamente pelo mesmo webhook;
- lançamento manual pela recepção para dinheiro, maquininha, Pix externo, transferência ou outra forma.

A função `create-service-payment` calcula o saldo no servidor, exige uma sessão ativa da recepção e nunca permite cobrar acima do valor restante do atendimento. O dashboard mostra receita por período, ticket médio, valores pendentes e totais por procedimento e profissional.

No painel do Mercado Pago, configure o webhook de pagamentos para:

```text
https://tprouhszfoofljcebtsd.supabase.co/functions/v1/mercado-pago-webhook
```

O indicador “Mercado Pago ativo” é habilitado automaticamente assim que o primeiro Pix for gerado com sucesso.

Antes de abrir para tráfego pago, faça uma reserva real de baixo valor e confirme no mesmo teste: geração do QR Code, mudança de pré-agendado para agendado, liberação para o profissional, e-mails do cliente/profissional, evento `Purchase` e lançamento no faturamento.

As credenciais do Mercado Pago ficam somente nos secrets das Edge Functions. Elas nunca são expostas ao navegador ou ao repositório.
