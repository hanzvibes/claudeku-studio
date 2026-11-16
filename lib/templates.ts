// Metadata 9 template threejs-cinematic-short v3.8.
// Sumber kebenaran isi template ada di public/templates/*.html; data di sini
// (durasi, speaker, gaya caps/VO) dibaca dari file aslinya dan diverifikasi
// dengan scripts/lint_short.py — jangan ubah angka ini tanpa membaca ulang file.
export type TemplateMeta = {
  id: string;
  file: string;
  title: string;
  duration: number; // LEN, detik
  characters: number;
  speakers: string[]; // label speaker index 0..n (index terakhir = narator/keduanya)
  hasSpeakerField: boolean; // caps 4-elemen [start,end,text,speaker] vs 3-elemen
  voStyle: "explicit" | "derived"; // VO=[...] eksplisit vs VO=caps.map(c=>c[2])
  description: string;
};

export const TEMPLATES: TemplateMeta[] = [
  {
    id: "versus",
    file: "template.html",
    title: "Claude vs Codex",
    duration: 28,
    characters: 2,
    speakers: ["Claude", "Codex", "Keduanya / Narator"],
    hasSpeakerField: true,
    voStyle: "derived",
    description: "Debat dua AI: siapa paling jago nulis kode. Ada papan skor, berakhir seri lalu kerja bareng.",
  },
  {
    id: "trio",
    file: "template-trio.html",
    title: "Claude vs Codex vs Gemini",
    duration: 32,
    characters: 3,
    speakers: ["Claude", "Codex", "Gemini"],
    hasSpeakerField: true,
    voStyle: "derived",
    description: "Debat tiga AI. Gemini pamer konteks sejuta token, skor akhir seri.",
  },
  {
    id: "rival",
    file: "template-rival.html",
    title: "Musuhan Satu Meja",
    duration: 34,
    characters: 2,
    speakers: ["Claude", "Codex", "Keduanya / Narator"],
    hasSpeakerField: true,
    voStyle: "explicit",
    description: "Claude vs Codex musuhan satu meja: sticky notes, rebutan keyboard, lalu prod down dan akhirnya damai — sebentar.",
  },
  {
    id: "typing",
    file: "template-typing.html",
    title: "Claude × Remotion",
    duration: 26,
    characters: 1,
    speakers: ["Claude"],
    hasSpeakerField: false,
    voStyle: "explicit",
    description: "Satu maskot ngetik motion graphics di Remotion: sapa kamera, ngetik, render, confetti.",
  },
  {
    id: "deploy",
    file: "template-deploy.html",
    title: "Deploy Jumat Sore",
    duration: 29,
    characters: 1,
    speakers: ["Claude"],
    hasSpeakerField: false,
    voStyle: "derived",
    description: "Deploy Jumat sore, pipeline merah karena salah ketik satu huruf, diperbaiki, hijau lagi.",
  },
  {
    id: "bughunter",
    file: "template-bughunter.html",
    title: "Bug Hunter 02.00",
    duration: 33,
    characters: 1,
    speakers: ["Claude"],
    hasSpeakerField: true,
    voStyle: "explicit",
    description: "Jam 2 pagi server error 500, berburu bug, ternyata penulisnya diri sendiri 3 bulan lalu.",
  },
  {
    id: "bomb",
    file: "template-bomb.html",
    title: "Misi Mustahil: Merge Conflict",
    duration: 33,
    characters: 1,
    speakers: ["Claude"],
    hasSpeakerField: true,
    voStyle: "explicit",
    description: "Agen rahasia menjinakkan bom merge conflict 30 detik, lalu reviewer datang dengan 47 komentar.",
  },
  {
    id: "meeting",
    file: "template-meeting.html",
    title: "Rapat 5 Menit",
    duration: 33,
    characters: 1,
    speakers: ["Claude"],
    hasSpeakerField: true,
    voStyle: "explicit",
    description: "Rapat 5 menit yang jadi hampir 4 jam: mute, kopi, ngantuk, lalu ada rapat lanjutan besok jam 7.",
  },
  {
    id: "sleep",
    file: "template-sleep.html",
    title: "Ketiduran di Keyboard",
    duration: 36,
    characters: 1,
    speakers: ["Claude"],
    hasSpeakerField: true,
    voStyle: "explicit",
    description: "Maskot ketiduran di keyboard, bos datang membangunkan, lalu akhirnya kerja juga.",
  },
];

export function getTemplate(id: string): TemplateMeta | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

export function getTemplateByFile(file: string): TemplateMeta | undefined {
  return TEMPLATES.find((t) => t.file === file);
}
