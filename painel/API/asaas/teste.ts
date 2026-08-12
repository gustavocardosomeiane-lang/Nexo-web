export default function handler(req: any, res: any) {
  res.status(200).json({
    ok: true,
    mensagem: "API NEXO WEB funcionando",
  });
}
