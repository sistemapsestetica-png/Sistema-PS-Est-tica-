# E-mails de autenticação da PS Estética

## Confirmação de cadastro

- Assunto: `Confirme seu acesso à PS Estética`
- Arquivo: `confirmation.html`
- Remetente planejado: `PS Estética <acesso@notificacoes.psestetica.com.br>`
- Destino do botão: `{{ .RedirectTo }}/auth/confirm`

No projeto hospedado, o conteúdo deve ser aplicado em **Authentication → Email Templates → Confirm signup**.

Para habilitar o remetente próprio, configure o SMTP em **Authentication → Emails → SMTP Settings** somente depois de validar SPF, DKIM e DMARC para `notificacoes.psestetica.com.br`. Desative o rastreamento de links no provedor SMTP para não alterar os links de autenticação de uso único.
