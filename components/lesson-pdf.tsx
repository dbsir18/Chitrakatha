/**
 * React PDF template for a lesson export.
 * Used server-side only via @react-pdf/renderer — not rendered in the browser.
 *
 * Layout:
 *   Page 1  — title block + hero scene image + story (setting + narrative)
 *   Page 2+ — full numbered legend (symbol name · category · medical fact)
 */
import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
  Font,
} from "@react-pdf/renderer";
import type { LessonDetail } from "@/lib/types";
import type { SymbolWithImage } from "@/lib/types";
import type { QuizQuestionValue } from "@/lib/ai/schema";

// ── Typography ────────────────────────────────────────────────────────────────
// @react-pdf/renderer ships Helvetica and Times-Roman as built-in fonts.
Font.register({
  family: "Serif",
  fonts: [
    { src: "https://fonts.gstatic.com/s/ptserif/v18/EJRVQgYoZZY2vCFuvAFWzr8.ttf" },
    {
      src: "https://fonts.gstatic.com/s/ptserif/v18/EJRRQgYoZZY2vCFuvAFW9aCW.ttf",
      fontWeight: "bold",
    },
  ],
});

const CATEGORY_LABEL: Record<string, string> = {
  mechanism: "Mechanism",
  use: "Use",
  side_effect: "Side effect",
  dosing: "Dosing",
  organism: "Organism",
  feature: "Feature",
  potency: "Potency",
  example: "Example",
  other: "Other",
};

const CONTENT_TYPE_LABEL: Record<string, string> = {
  drug_profile: "Drug profile",
  organism_list: "Organism list",
  drug_hierarchy: "Hierarchy",
  general: "General",
};

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 9,
    color: "#1a1a2e",
    paddingTop: 40,
    paddingBottom: 48,
    paddingHorizontal: 44,
    backgroundColor: "#fdfaf6",
  },
  // ── Header
  header: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  badge: {
    fontSize: 7,
    color: "#78716c",
    textTransform: "uppercase",
    letterSpacing: 1,
    borderWidth: 0.5,
    borderColor: "#d6d3d1",
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 1.5,
  },
  topic: { fontSize: 8, color: "#78716c" },
  sceneName: {
    fontFamily: "Serif",
    fontWeight: "bold",
    fontSize: 22,
    color: "#1c1917",
    marginBottom: 12,
    lineHeight: 1.2,
  },
  // ── Hero image
  heroWrapper: {
    width: "100%",
    aspectRatio: "3/2",
    borderRadius: 6,
    overflow: "hidden",
    marginBottom: 16,
    backgroundColor: "#e7e5e4",
  },
  heroImage: { width: "100%", height: "100%", objectFit: "cover" },
  // ── Story
  sectionLabel: {
    fontSize: 7,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: "#a8a29e",
    marginBottom: 5,
    marginTop: 14,
  },
  storyText: { fontSize: 9, color: "#292524", lineHeight: 1.6 },
  // ── Legend
  legendRow: {
    flexDirection: "row",
    gap: 6,
    paddingVertical: 5,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e7e5e4",
  },
  legendNum: { width: 18, fontSize: 8, color: "#a8a29e", flexShrink: 0 },
  legendBody: { flex: 1 },
  legendName: { fontSize: 9, fontFamily: "Helvetica-Bold", color: "#1c1917", marginBottom: 1 },
  legendNameIntro: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#1c1917",
    marginBottom: 1,
    borderLeftWidth: 2,
    borderLeftColor: "#d97706",
    paddingLeft: 4,
  },
  legendCat: { fontSize: 7, color: "#a8a29e", textTransform: "uppercase", letterSpacing: 0.5 },
  legendFact: { fontSize: 8.5, color: "#292524", lineHeight: 1.45, marginTop: 1 },
  // ── Footer
  footer: {
    position: "absolute",
    bottom: 20,
    left: 44,
    right: 44,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerText: { fontSize: 7, color: "#a8a29e" },
});

// ── Components ────────────────────────────────────────────────────────────────
function Footer({ pageNum, total, sceneName }: { pageNum: number; total: number; sceneName: string }) {
  return (
    <View style={s.footer} fixed>
      <Text style={s.footerText}>Chitrakatha · {sceneName}</Text>
      <Text style={s.footerText}>
        {pageNum} / {total}
      </Text>
    </View>
  );
}

// ── Main document ─────────────────────────────────────────────────────────────
export function LessonPDF({ lesson }: { lesson: LessonDetail }) {
  const symbols = lesson.symbols as SymbolWithImage[];

  return (
    <Document
      title={lesson.sceneName}
      author="Chitrakatha"
      subject={lesson.topic}
      creator="Chitrakatha"
    >
      {/* ── Page 1: title + image + story ── */}
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <Text style={s.badge}>{CONTENT_TYPE_LABEL[lesson.contentType] ?? lesson.contentType}</Text>
          <Text style={s.topic}>{lesson.topic}</Text>
        </View>

        <Text style={s.sceneName}>{lesson.sceneName}</Text>

        {lesson.sceneImageUrl && (
          <View style={s.heroWrapper}>
            <Image src={lesson.sceneImageUrl} style={s.heroImage} />
          </View>
        )}

        <Text style={s.sectionLabel}>Setting</Text>
        <Text style={s.storyText}>{lesson.setting}</Text>

        <Text style={s.sectionLabel}>Story</Text>
        <Text style={s.storyText}>{lesson.narrative}</Text>

        <Footer pageNum={1} total={2} sceneName={lesson.sceneName} />
      </Page>

      {/* ── Page 2: full symbol legend ── */}
      <Page size="A4" style={s.page}>
        <Text style={[s.sceneName, { fontSize: 14, marginBottom: 4 }]}>{lesson.sceneName}</Text>
        <Text style={[s.sectionLabel, { marginTop: 0 }]}>Symbol legend — {symbols.length} symbols</Text>

        <View>
          {symbols.map((symbol, i) => (
            <View key={i} style={s.legendRow} wrap={false}>
              <Text style={s.legendNum}>{i + 1}.</Text>
              <View style={s.legendBody}>
                <Text style={symbol.isGroupIntro ? s.legendNameIntro : s.legendName}>
                  {symbol.name}
                </Text>
                <Text style={s.legendCat}>{CATEGORY_LABEL[symbol.category] ?? symbol.category}</Text>
                <Text style={s.legendFact}>{symbol.medicalFact}</Text>
              </View>
            </View>
          ))}
        </View>

        <Footer pageNum={2} total={2} sceneName={lesson.sceneName} />
      </Page>
    </Document>
  );
}
