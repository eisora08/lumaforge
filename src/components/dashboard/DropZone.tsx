import { UploadCloud, FolderOpen } from "lucide-react";

type DropZoneProps = {
  onBrowse: () => void;
};

export default function DropZone({ onBrowse }: DropZoneProps) {
  return (
    <section className="border border-white/15 bg-white/[0.03] rounded-2xl p-8 text-center">
      <div className="mx-auto mb-4 h-14 w-14 rounded-2xl bg-[#b8d7dc]/10 border border-[#b8d7dc]/20 flex items-center justify-center">
        <UploadCloud className="h-7 w-7 text-[#b8d7dc]" strokeWidth={1.8} />
      </div>

      <h3 className="font-semibold text-white">
        Instalar paquete manualmente
      </h3>

      <p className="text-gray-400 text-sm mt-2 max-w-md mx-auto">
        Arrastra un .zip, .lua o .manifest. LumaForge enviará cada archivo a su carpeta correcta.
      </p>

      <button
        onClick={onBrowse}
        className="mt-5 inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-sm transition"
      >
        <FolderOpen className="h-4 w-4" />
        Buscar archivos
      </button>
    </section>
  );
}