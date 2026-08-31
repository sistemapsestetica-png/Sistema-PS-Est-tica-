# Reconciliação do histórico de migrations

Data da auditoria: 2026-08-31
Branch: `chore/supabase-migration-reconciliation`

## Objetivo e limites

Este documento registra a reconciliação **somente local** entre os arquivos em `supabase/migrations/` e o histórico existente no Supabase remoto usado em produção.

Nenhuma migration deste conjunto foi aplicada ou reaplicada no banco remoto durante a reconciliação. Não foram usados `db push`, `migration up`, `migration repair` ou `db reset`. Os arquivos históricos abaixo representam o SQL registrado no momento da aplicação e **não devem ser reaplicados no banco de produção atual**.

## Migrations remotas recuperadas

As seis migrations fundacionais que não existiam no repositório foram recuperadas diretamente de `supabase_migrations.schema_migrations`, preservando timestamps, nomes e SQL registrados no remoto:

- `20260811173853_initial_agenda_leads_auth.sql`
- `20260811174046_harden_policies_and_indexes.sql`
- `20260811174604_repair_public_slot_rpc.sql`
- `20260811203333_complete_booking_funnel.sql`
- `20260811203851_repair_booking_reservation_defaults.sql`
- `20260811203920_optimize_admin_allowlist_policy.sql`

## Timestamps locais reconciliados

Cinco migrations locais já tinham efeito equivalente no remoto, mas estavam registradas lá com outro timestamp. Os nomes locais antigos foram substituídos pelos timestamps canônicos do histórico remoto:

| Timestamp local anterior | Timestamp remoto canônico | Migration | Evidência |
| --- | --- | --- | --- |
| `20260813112000` | `20260813142737` | `team_schedules_and_automatic_pix` | SQL equivalente após normalização |
| `20260813123000` | `20260813142849` | `booking_created_by_index` | Mesmo `CREATE INDEX`; diferença apenas de comentário e delimitador |
| `20260813193901` | `20260813195038` | `receptionist_master_permissions` | SQL equivalente após normalização |
| `20260813220000` | `20260813214844` | `secure_quiz_reservations` | SQL equivalente após normalização |
| `20260813223000` | `20260813215110` | `disable_legacy_quiz_reservations` | SQL equivalente após normalização |

Os arquivos canônicos foram recuperados do histórico remoto. Os arquivos com timestamps antigos não permanecem em paralelo, evitando que a CLI os interprete como migrations pendentes.

## Migrations com timestamp já coincidente

Para migrations cujo timestamp já coincidia, `supabase migration fetch --linked` restaurou a representação histórica armazenada no remoto. Isso inclui diferenças de comentários, delimitadores, formatação e, quando existente, SQL histórico que não é idêntico ao runtime atual.

Diferença relevante confirmada:

- `20260824115838_master_access_approval.sql`: o SQL histórico recuperado não contém a guarda `new.email_confirmed_at is null` na versão original de `queue_staff_access_request()`. A definição runtime atual contém essa guarda, indicando alteração posterior. O arquivo histórico não foi reescrito para imitar o runtime. Uma eventual formalização dessa alteração deverá ser feita em migration incremental futura.

Outros arquivos de timestamp coincidente também foram preservados exatamente como retornados pelo histórico remoto, mesmo quando a versão local anterior continha comentários ou delimitadores adicionais.

## Estado runtime confirmado em leitura

- PostgreSQL remoto: `17.6`.
- Enum de aplicação: `public.staff_role` com `receptionist` e `professional`.
- Não existem views da aplicação nos schemas `public` ou `private`.
- Extensões presentes: `pg_cron`, `pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault` e `uuid-ossp`.
- Cron ativo: `release-expired-prebookings`, a cada minuto, executando `select public.release_expired_reservations()`.
- As funções `SECURITY DEFINER` auditadas em `public` e `private` têm `search_path` runtime explicitamente vazio.
- A função runtime `public.queue_staff_access_request()` exige `email_confirmed_at` antes de criar a solicitação.
- Os grants runtime confirmam que RPCs legadas `capture_lead` e `reserve_slot` não são executáveis por `anon` ou `authenticated`; as versões seguras e os endpoints públicos intencionais mantêm os grants existentes.

## Segurança adiada deliberadamente

As melhorias abaixo foram apenas registradas e não implementadas nesta reconciliação:

- isolamento mais forte da sessão em `capture_lead_session` para impedir recuperação de token por coincidência de telefone e serviço na janela de deduplicação;
- formalização, por migration incremental, da guarda de e-mail confirmado em `queue_staff_access_request`, se ela não estiver representada em migration posterior rastreável.

Nenhuma RPC, policy RLS, trigger, enum, tabela ou dado foi alterado no remoto.

## Itens sem confirmação integral

- A origem histórica exata da alteração runtime que adicionou `email_confirmed_at` a `queue_staff_access_request()` não aparece como migration separada no histórico remoto disponível. O runtime foi confirmado, mas a alteração intermediária pode ter sido executada manualmente.
- Não foi executada reconstrução completa em banco local descartável nesta etapa. Essa validação depende de um ambiente local isolado com Docker/Postgres e deve permanecer totalmente desconectada do projeto de produção.

## Regra para trabalho futuro

O banco remoto atual continua sendo a referência de produção. Correções de segurança, novas colunas, eventos, CRM, funil ou agenda devem ser implementados somente em novas migrations incrementais, após revisão. Nunca editar estes arquivos históricos para representar o runtime atual e nunca reaplicá-los sobre o banco de produção existente.
