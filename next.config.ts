import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/",
          has: [{ type: "host", value: "agenda.psestetica.com.br" }],
          destination: "/agendar",
        },
        {
          source: "/",
          has: [{ type: "host", value: "painel.psestetica.com.br" }],
          destination: "/admin",
        },
        {
          source: "/",
          has: [{ type: "host", value: "profissional.psestetica.com.br" }],
          destination: "/profissional",
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
