"use client";

import type { EmailOtpType } from "@supabase/supabase-js";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";
import "./confirm.css";

type ConfirmationState = "checking" | "success" | "error";

function ConfirmationContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState<ConfirmationState>("checking");

  useEffect(() => {
    let active = true;
    let redirectTimer: ReturnType<typeof setTimeout> | undefined;

    async function confirmAccess() {
      const tokenHash = searchParams.get("token_hash");
      const type = searchParams.get("type") as EmailOtpType | null;

      if (tokenHash && type) {
        const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
        if (!active) return;
        if (error) {
          setState("error");
          return;
        }
      } else {
        const { data } = await supabase.auth.getSession();
        if (!active) return;
        if (!data.session) {
          setState("error");
          return;
        }
      }

      setState("success");
      redirectTimer = setTimeout(() => router.replace("/"), 1800);
    }

    void confirmAccess();

    return () => {
      active = false;
      if (redirectTimer) clearTimeout(redirectTimer);
    };
  }, [router, searchParams]);

  return (
    <main className="confirmation-page">
      <div className="confirmation-glow confirmation-glow-one" />
      <div className="confirmation-glow confirmation-glow-two" />
      <section className="confirmation-card" aria-live="polite">
        <div className="confirmation-logo-wrap">
          <img src="/ps-estetica-logo-oficial.png" width="246" height="80" alt="PS Estética" />
        </div>
        <p className="confirmation-eyebrow">Acesso seguro</p>

        {state === "checking" && (
          <>
            <span className="confirmation-loader" aria-hidden="true" />
            <h1>Confirmando seu acesso</h1>
            <p>Estamos validando seu e-mail. Isso leva apenas alguns segundos.</p>
          </>
        )}

        {state === "success" && (
          <>
            <span className="confirmation-icon success" aria-hidden="true">✓</span>
            <h1>E-mail confirmado</h1>
            <p>Seu acesso à PS Estética está pronto. Você será direcionado para sua área.</p>
            <button type="button" onClick={() => router.replace("/")}>Continuar</button>
          </>
        )}

        {state === "error" && (
          <>
            <span className="confirmation-icon error" aria-hidden="true">!</span>
            <h1>Este link não está mais válido</h1>
            <p>Ele pode ter expirado ou já ter sido utilizado. Volte ao acesso e solicite um novo e-mail.</p>
            <Link href="/">Voltar para o acesso</Link>
          </>
        )}

        <div className="confirmation-divider" />
        <small>PS Estética · cuidado, segurança e naturalidade</small>
      </section>
    </main>
  );
}

export default function ConfirmationPage() {
  return (
    <Suspense fallback={<main className="confirmation-page" />}>
      <ConfirmationContent />
    </Suspense>
  );
}
