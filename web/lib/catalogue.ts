/**
 * The lab's test menu: what can be measured (analytes), what can be requested (panels), starter prices
 * and the demo reagent stock. This file is the single source; the database copy is refreshed from it at start-up.
 *
 * Reference ranges: the original 18 rows keep their sources. Every range added here is a typical adult range
 * and is labelled so: each lab must verify ranges for its own method, analyser and population before go-live.
 * Prices are starter prices in naira, shown as unconfirmed until a chief scientist or administrator saves them.
 */

export type ResultType = "numeric" | "qualitative" | "choice" | "text";
export type Analyte = {
  code: string; name: string; department: string; specimen: string; result_type: ResultType;
  unit: string | null; ref_low: number | null; ref_high: number | null; ref_sex: "" | "F" | "M";
  ref_text: string; ref_source: string | null; calc_formula: string | null;
  /** qualitative: "negative label|positive label". choice: options separated by "|"; a trailing * marks an abnormal option. */
  options: string | null; plaus_low: number | null; plaus_high: number | null; optional: 0 | 1;
};
export type Panel = { code: string; name: string; department: string; tests: string[]; fasting?: boolean; tat_hours: number; price: number };

const VERIFY = "Typical adult range: verify for your method";
type Opt = Partial<Pick<Analyte, "ref_sex" | "ref_source" | "calc_formula" | "options" | "optional">> & { plaus?: [number, number] };
const base = (code: string, name: string, department: string, specimen: string, result_type: ResultType, unit: string | null,
  ref_low: number | null, ref_high: number | null, ref_text: string, o: Opt = {}): Analyte => ({
  code, name, department, specimen, result_type, unit, ref_low, ref_high, ref_sex: o.ref_sex ?? "", ref_text,
  ref_source: o.ref_source === undefined ? VERIFY : o.ref_source, calc_formula: o.calc_formula ?? null, options: o.options ?? null,
  plaus_low: o.plaus?.[0] ?? null, plaus_high: o.plaus?.[1] ?? null, optional: o.optional ?? 0,
});
/** Numeric analyte. Pass [F, M] pairs for sex-specific ranges. */
const num = (code: string, name: string, dept: string, spec: string, unit: string, low: number | null, high: number | null, ref: string, plaus: [number, number], o: Opt = {}) =>
  [base(code, name, dept, spec, "numeric", unit, low, high, ref, { ...o, plaus })];
const numFM = (code: string, name: string, dept: string, spec: string, unit: string, f: [number | null, number | null, string], m: [number | null, number | null, string], plaus: [number, number], o: Opt = {}) =>
  [base(code, name, dept, spec, "numeric", unit, f[0], f[1], f[2], { ...o, plaus, ref_sex: "F" }), base(code, name, dept, spec, "numeric", unit, m[0], m[1], m[2], { ...o, plaus, ref_sex: "M" })];
const qual = (code: string, name: string, dept: string, spec: string, ref = "Negative", options = "Negative|Positive", o: Opt = {}) =>
  [base(code, name, dept, spec, "qualitative", null, null, null, ref, { ref_source: null, ...o, options })];
const serol = (code: string, name: string, spec = "Serum") => qual(code, name, "Serology", spec, "Non-reactive", "Non-reactive|Reactive");
const choice = (code: string, name: string, dept: string, spec: string, options: string, ref: string, o: Opt = {}) =>
  [base(code, name, dept, spec, "choice", null, null, null, ref, { ref_source: null, ...o, options })];
const text = (code: string, name: string, dept: string, spec: string, ref: string, o: Opt = {}) =>
  [base(code, name, dept, spec, "text", null, null, null, ref, { ref_source: null, ...o })];

const GRADES = "Negative|Trace*|1+*|2+*|3+*";
const WIDAL_TITRES = "< 1/20|1/20|1/40|1/80|1/160*|1/320*";

// Cultures: one set of analytes per specimen, so two cultures in one request never share a result row.
const CULTURES: [string, string, string, number][] = [
  ["URINE", "Urine", "Midstream urine", 72], ["STOOL", "Stool", "Stool", 72], ["HVS", "High vaginal swab", "High vaginal swab", 72],
  ["ECS", "Endocervical swab", "Endocervical swab", 72], ["URETH", "Urethral swab", "Urethral swab", 72], ["WOUND", "Wound swab", "Wound swab", 72],
  ["SPUT", "Sputum", "Sputum", 72], ["BLOOD", "Blood", "Blood culture bottle", 120], ["EAR", "Ear swab", "Ear swab", 72], ["EYE", "Eye swab", "Eye swab", 72],
  ["THROAT", "Throat swab", "Throat swab", 72], ["SEMEN", "Seminal fluid", "Seminal fluid", 72], ["CSFC", "Cerebrospinal fluid", "CSF", 72], ["PUS", "Pus / aspirate", "Pus or aspirate", 72],
];
const cultureAnalytes = CULTURES.flatMap(([k, n, spec]) => [
  ...text(`${k}_MIC`, `${n}: microscopy`, "Microbiology", spec, "Pus cells, epithelial cells, organisms seen"),
  ...choice(`${k}_CUL`, `${n}: culture`, "Microbiology", spec,
    k === "BLOOD" ? "No growth after 5 days|Growth*" : "No growth after 48 h|No significant growth|Significant growth*|Mixed growth (likely contamination)*",
    k === "BLOOD" ? "No growth after 5 days" : "No significant growth"),
  ...text(`${k}_ORG`, `${n}: organism isolated`, "Microbiology", spec, "Organism and colony count, if any growth", { optional: 1 }),
  ...text(`${k}_AST`, `${n}: antibiotic sensitivity`, "Microbiology", spec, "Sensitive (S) / Intermediate (I) / Resistant (R)", { optional: 1 }),
]);

export const ANALYTES: Analyte[] = [
  // ── The original 18 (sources unchanged) ──────────────────────────────────
  ...num("FBG", "Fasting Blood Glucose", "Clinical Chemistry", "Fluoride plasma", "mmol/L", 3.9, 6.0, "3.9-6.0 mmol/L", [0.5, 50], { ref_source: "WHO" }),
  ...num("TC", "Total Cholesterol", "Clinical Chemistry", "Serum", "mmol/L", null, 5.2, "< 5.2 mmol/L desirable", [0.5, 25], { ref_source: "NCEP ATP III" }),
  ...num("HDL", "HDL Cholesterol", "Clinical Chemistry", "Serum", "mmol/L", 1.0, null, ">= 1.0 mmol/L (>= 1.55 protective)", [0.1, 5], { ref_source: "NCEP ATP III" }),
  ...num("TG", "Triglycerides", "Clinical Chemistry", "Serum", "mmol/L", null, 1.7, "< 1.7 mmol/L", [0.1, 50], { ref_source: "NCEP ATP III" }),
  ...num("LDL", "LDL Cholesterol", "Clinical Chemistry", "Serum", "mmol/L", null, 2.6, "< 2.6 mmol/L optimal", [0, 25], { ref_source: "NCEP ATP III", calc_formula: "friedewald_mmol" }),
  ...num("TCHDL", "TC / HDL ratio", "Clinical Chemistry", "Serum", "ratio", null, 5.0, "< 5.0", [0, 50], { ref_source: "Lab-validated", calc_formula: "tc_over_hdl" }),
  ...numFM("HB", "Haemoglobin", "Haematology", "EDTA whole blood", "g/dL", [12.0, 15.5, "12.0-15.5 g/dL"], [13.0, 17.0, "13.0-17.0 g/dL"], [2, 25], { ref_source: "Lab-validated" }),
  ...numFM("PCV", "Packed Cell Volume", "Haematology", "EDTA whole blood", "%", [36, 46, "36-46 %"], [40, 50, "40-50 %"], [5, 75], { ref_source: "Lab-validated" }),
  ...num("WBC", "White Cell Count", "Haematology", "EDTA whole blood", "x10^9/L", 4.0, 10.0, "4.0-10.0 x10^9/L", [0.1, 200], { ref_source: "Lab-validated" }),
  ...num("PLT", "Platelets", "Haematology", "EDTA whole blood", "x10^9/L", 150, 410, "150-410 x10^9/L", [1, 2000], { ref_source: "Lab-validated" }),
  ...qual("MAL", "Malaria RDT", "Parasitology", "EDTA whole blood", "Negative", "Negative|Positive", { ref_source: "WHO" }),
  ...choice("BG", "Blood Group (ABO/RhD)", "Blood Bank", "EDTA whole blood",
    "O RhD positive|O RhD negative|A RhD positive|A RhD negative|B RhD positive|B RhD negative|AB RhD positive|AB RhD negative", "Report ABO group and RhD type"),
  ...qual("HPSA", "H. pylori Stool Antigen", "Microbiology", "Stool"),
  ...qual("HPIGG", "H. pylori Antibody (IgG)", "Serology", "Serum"),
  ...qual("FIT", "Faecal Immunochemical Test", "Clinical Chemistry", "Stool"),
  ...num("MANTOUX", "Tuberculin Skin Test (Mantoux)", "Immunology", "Intradermal", "mm", null, null, "< 10 mm negative (>= 5 mm if high-risk)", [0, 40], { ref_source: "CDC/WHO" }),

  // ── Haematology ──────────────────────────────────────────────────────────
  ...numFM("RBC", "Red Cell Count", "Haematology", "EDTA whole blood", "x10^12/L", [3.8, 4.8, "3.8-4.8 x10^12/L"], [4.5, 5.5, "4.5-5.5 x10^12/L"], [0.5, 10]),
  ...num("MCV", "Mean Cell Volume", "Haematology", "EDTA whole blood", "fL", 83, 101, "83-101 fL", [40, 160], { calc_formula: "mcv" }),
  ...num("MCH", "Mean Cell Haemoglobin", "Haematology", "EDTA whole blood", "pg", 27, 32, "27-32 pg", [10, 60], { calc_formula: "mch" }),
  ...num("MCHC", "Mean Cell Hb Concentration", "Haematology", "EDTA whole blood", "g/dL", 31.5, 34.5, "31.5-34.5 g/dL", [20, 45], { calc_formula: "mchc" }),
  ...num("NEUT", "Neutrophils", "Haematology", "EDTA whole blood", "%", 40, 80, "40-80 % (often lower in people of African ancestry)", [0, 100]),
  ...num("LYMPH", "Lymphocytes", "Haematology", "EDTA whole blood", "%", 20, 40, "20-40 %", [0, 100]),
  ...num("MONO", "Monocytes", "Haematology", "EDTA whole blood", "%", 2, 10, "2-10 %", [0, 100]),
  ...num("EOS", "Eosinophils", "Haematology", "EDTA whole blood", "%", 1, 6, "1-6 %", [0, 100]),
  ...num("BASO", "Basophils", "Haematology", "EDTA whole blood", "%", 0, 2, "0-2 %", [0, 100]),
  ...numFM("ESR", "Erythrocyte Sedimentation Rate (Westergren)", "Haematology", "EDTA / citrate whole blood", "mm/h", [0, 20, "0-20 mm/h"], [0, 15, "0-15 mm/h"], [0, 200]),
  ...num("RETIC", "Reticulocyte Count", "Haematology", "EDTA whole blood", "%", 0.5, 2.5, "0.5-2.5 %", [0, 50]),
  ...choice("GENO", "Haemoglobin Genotype", "Haematology", "EDTA whole blood", "AA|AS|AC|SS|SC|CC", "Report the haemoglobin genotype"),
  ...qual("SICKLE", "Sickling Test", "Haematology", "EDTA whole blood"),
  ...text("FILM", "Peripheral Blood Film", "Haematology", "EDTA whole blood", "Red cells, white cells and platelets: describe morphology"),
  ...choice("G6PD", "G6PD Screen", "Haematology", "EDTA whole blood", "Normal|Partially deficient*|Deficient*", "Normal"),
  ...num("PT", "Prothrombin Time", "Haematology", "Citrated plasma", "s", 11, 13.5, "11-13.5 s", [5, 150]),
  ...num("INR", "INR", "Haematology", "Citrated plasma", "ratio", 0.8, 1.2, "0.8-1.2 (target 2-3 on warfarin)", [0.5, 15]),
  ...num("APTT", "Activated Partial Thromboplastin Time", "Haematology", "Citrated plasma", "s", 25, 35, "25-35 s", [10, 200]),
  ...num("BT", "Bleeding Time (Ivy)", "Haematology", "Capillary", "min", 2, 7, "2-7 min", [0, 60]),
  ...num("CT", "Clotting Time (Lee-White)", "Haematology", "Whole blood", "min", 5, 11, "5-11 min", [0, 60]),
  ...num("DDIMER", "D-Dimer", "Haematology", "Citrated plasma", "mg/L FEU", null, 0.5, "< 0.5 mg/L FEU", [0, 100]),
  ...num("FIBR", "Fibrinogen", "Haematology", "Citrated plasma", "g/L", 2.0, 4.0, "2.0-4.0 g/L", [0.1, 15]),

  // ── Blood bank ───────────────────────────────────────────────────────────
  ...qual("DAT", "Direct Antiglobulin (Coombs) Test", "Blood Bank", "EDTA whole blood"),
  ...choice("XM", "Crossmatch", "Blood Bank", "EDTA whole blood + donor unit", "Compatible|Incompatible*", "Compatible"),

  // ── Clinical chemistry ───────────────────────────────────────────────────
  ...num("RBG", "Random Blood Glucose", "Clinical Chemistry", "Fluoride plasma", "mmol/L", null, 7.8, "< 7.8 mmol/L", [0.5, 50]),
  ...num("PPG2", "2-hour Post-prandial Glucose", "Clinical Chemistry", "Fluoride plasma", "mmol/L", null, 7.8, "< 7.8 mmol/L", [0.5, 50]),
  ...num("OGTT0", "OGTT: fasting glucose", "Clinical Chemistry", "Fluoride plasma", "mmol/L", 3.9, 6.0, "3.9-6.0 mmol/L", [0.5, 50], { ref_source: "WHO" }),
  ...num("OGTT120", "OGTT: 2-hour glucose (75 g)", "Clinical Chemistry", "Fluoride plasma", "mmol/L", null, 7.8, "< 7.8 mmol/L (7.8-11.0 impaired; >= 11.1 diabetes)", [0.5, 50], { ref_source: "WHO" }),
  ...num("HBA1C", "Glycated Haemoglobin (HbA1c)", "Clinical Chemistry", "EDTA whole blood", "%", null, 5.7, "< 5.7 % (5.7-6.4 prediabetes; >= 6.5 diabetes)", [2, 25], { ref_source: "ADA" }),
  ...num("NA", "Sodium", "Clinical Chemistry", "Serum", "mmol/L", 135, 145, "135-145 mmol/L", [90, 200]),
  ...num("K", "Potassium", "Clinical Chemistry", "Serum", "mmol/L", 3.5, 5.1, "3.5-5.1 mmol/L", [1, 10]),
  ...num("CL", "Chloride", "Clinical Chemistry", "Serum", "mmol/L", 98, 107, "98-107 mmol/L", [60, 150]),
  ...num("HCO3", "Bicarbonate", "Clinical Chemistry", "Serum", "mmol/L", 22, 29, "22-29 mmol/L", [2, 60]),
  ...num("UREA", "Urea", "Clinical Chemistry", "Serum", "mmol/L", 2.5, 7.8, "2.5-7.8 mmol/L", [0.5, 100]),
  ...numFM("CREA", "Creatinine", "Clinical Chemistry", "Serum", "umol/L", [44, 80, "44-80 umol/L"], [62, 106, "62-106 umol/L"], [10, 3000]),
  ...num("EGFR", "eGFR (CKD-EPI 2021)", "Clinical Chemistry", "Serum", "mL/min/1.73m2", 90, null, ">= 90 mL/min/1.73m2", [0, 250], { calc_formula: "ckd_epi_2021", ref_source: "KDIGO" }),
  ...num("TBIL", "Total Bilirubin", "Clinical Chemistry", "Serum", "umol/L", null, 21, "< 21 umol/L", [0, 800]),
  ...num("DBIL", "Direct Bilirubin", "Clinical Chemistry", "Serum", "umol/L", null, 5, "< 5 umol/L", [0, 500]),
  ...numFM("ALT", "Alanine Aminotransferase (ALT)", "Clinical Chemistry", "Serum", "U/L", [null, 33, "<= 33 U/L"], [null, 41, "<= 41 U/L"], [0, 10000]),
  ...numFM("AST", "Aspartate Aminotransferase (AST)", "Clinical Chemistry", "Serum", "U/L", [null, 32, "<= 32 U/L"], [null, 40, "<= 40 U/L"], [0, 10000]),
  ...numFM("ALP", "Alkaline Phosphatase (ALP)", "Clinical Chemistry", "Serum", "U/L", [35, 104, "35-104 U/L"], [40, 129, "40-129 U/L"], [5, 5000]),
  ...numFM("GGT", "Gamma-Glutamyl Transferase (GGT)", "Clinical Chemistry", "Serum", "U/L", [6, 42, "6-42 U/L"], [10, 71, "10-71 U/L"], [1, 5000]),
  ...num("TP", "Total Protein", "Clinical Chemistry", "Serum", "g/L", 66, 83, "66-83 g/L", [20, 150]),
  ...num("ALB", "Albumin", "Clinical Chemistry", "Serum", "g/L", 35, 52, "35-52 g/L", [5, 70]),
  ...num("GLOB", "Globulin", "Clinical Chemistry", "Serum", "g/L", 20, 35, "20-35 g/L", [0, 120], { calc_formula: "globulin" }),
  ...numFM("UA", "Uric Acid", "Clinical Chemistry", "Serum", "umol/L", [155, 357, "155-357 umol/L"], [208, 428, "208-428 umol/L"], [20, 2000]),
  ...num("CA", "Calcium (total)", "Clinical Chemistry", "Serum", "mmol/L", 2.15, 2.5, "2.15-2.50 mmol/L", [0.5, 5]),
  ...num("PHOS", "Phosphate", "Clinical Chemistry", "Serum", "mmol/L", 0.81, 1.45, "0.81-1.45 mmol/L", [0.1, 6]),
  ...num("MG", "Magnesium", "Clinical Chemistry", "Serum", "mmol/L", 0.66, 1.07, "0.66-1.07 mmol/L", [0.1, 5]),
  ...num("AMY", "Amylase", "Clinical Chemistry", "Serum", "U/L", 28, 100, "28-100 U/L", [1, 10000]),
  ...num("LIP", "Lipase", "Clinical Chemistry", "Serum", "U/L", 13, 60, "13-60 U/L", [1, 20000]),
  ...numFM("CK", "Creatine Kinase (CK)", "Clinical Chemistry", "Serum", "U/L", [26, 192, "26-192 U/L"], [39, 308, "39-308 U/L"], [1, 100000]),
  ...num("LDH", "Lactate Dehydrogenase (LDH)", "Clinical Chemistry", "Serum", "U/L", 135, 225, "135-225 U/L", [10, 10000]),
  ...qual("TROP", "Troponin I (rapid)", "Clinical Chemistry", "Serum / whole blood"),
  ...numFM("FE", "Serum Iron", "Clinical Chemistry", "Serum", "umol/L", [9.0, 30.4, "9.0-30.4 umol/L"], [11.6, 31.3, "11.6-31.3 umol/L"], [0.5, 100]),
  ...num("TIBC", "Total Iron-Binding Capacity", "Clinical Chemistry", "Serum", "umol/L", 45, 76, "45-76 umol/L", [10, 150]),
  ...numFM("FERR", "Ferritin", "Clinical Chemistry", "Serum", "ug/L", [13, 150, "13-150 ug/L"], [30, 400, "30-400 ug/L"], [1, 100000]),
  ...num("CRP", "C-Reactive Protein", "Clinical Chemistry", "Serum", "mg/L", null, 5, "< 5 mg/L", [0, 600]),
  ...num("HSCRP", "hs-CRP (cardiac risk)", "Clinical Chemistry", "Serum", "mg/L", null, 3, "< 1 low risk; 1-3 average; > 3 high risk", [0, 100]),
  ...num("UACR", "Urine Albumin:Creatinine Ratio", "Clinical Chemistry", "Spot urine", "mg/mmol", null, 3, "< 3 mg/mmol", [0, 1000], { ref_source: "KDIGO" }),
  ...num("UPROT24", "24-hour Urine Protein", "Clinical Chemistry", "24-hour urine", "g/24 h", null, 0.15, "< 0.15 g/24 h", [0, 30]),
  ...num("VITD", "25-OH Vitamin D", "Clinical Chemistry", "Serum", "nmol/L", 50, 125, "50-125 nmol/L sufficient (< 30 deficient)", [1, 600]),
  ...num("B12", "Vitamin B12", "Clinical Chemistry", "Serum", "pmol/L", 145, 569, "145-569 pmol/L", [10, 5000]),
  ...num("FOL", "Folate (serum)", "Clinical Chemistry", "Serum", "nmol/L", 8.83, 60.8, "8.83-60.8 nmol/L", [0.5, 200]),
  ...num("INS", "Insulin (fasting)", "Clinical Chemistry", "Serum", "uIU/mL", 2.6, 24.9, "2.6-24.9 uIU/mL", [0.1, 1000]),

  // ── Endocrinology and tumour markers ─────────────────────────────────────
  ...num("TSH", "TSH", "Endocrinology", "Serum", "mIU/L", 0.27, 4.2, "0.27-4.20 mIU/L", [0.001, 500]),
  ...num("FT4", "Free T4", "Endocrinology", "Serum", "pmol/L", 12, 22, "12-22 pmol/L", [0.5, 150]),
  ...num("FT3", "Free T3", "Endocrinology", "Serum", "pmol/L", 3.1, 6.8, "3.1-6.8 pmol/L", [0.5, 60]),
  ...num("FSH", "FSH", "Endocrinology", "Serum", "IU/L", null, null, "Depends on sex and cycle phase: see lab chart", [0, 300]),
  ...num("LH", "LH", "Endocrinology", "Serum", "IU/L", null, null, "Depends on sex and cycle phase: see lab chart", [0, 300]),
  ...numFM("PRL", "Prolactin", "Endocrinology", "Serum", "ng/mL", [4.79, 23.3, "4.79-23.3 ng/mL"], [4.04, 15.2, "4.04-15.2 ng/mL"], [0, 1000]),
  ...num("PROG", "Progesterone", "Endocrinology", "Serum", "nmol/L", null, null, "Depends on cycle phase: see lab chart", [0, 500]),
  ...num("E2", "Oestradiol", "Endocrinology", "Serum", "pmol/L", null, null, "Depends on sex and cycle phase: see lab chart", [0, 20000]),
  ...numFM("TESTO", "Testosterone (total)", "Endocrinology", "Serum", "nmol/L", [0.29, 1.67, "0.29-1.67 nmol/L"], [8.64, 29.0, "8.64-29.0 nmol/L"], [0, 100]),
  ...num("BHCG", "Beta-hCG (quantitative)", "Endocrinology", "Serum", "mIU/mL", null, null, "< 5 mIU/mL: not pregnant", [0, 500000]),
  ...num("AMH", "Anti-Mullerian Hormone", "Endocrinology", "Serum", "ng/mL", null, null, "Age-dependent: see lab chart", [0, 50]),
  ...num("CORT", "Cortisol (07:00-10:00)", "Endocrinology", "Serum", "nmol/L", 166, 507, "166-507 nmol/L (morning)", [5, 3000]),
  ...num("PSA", "PSA (total)", "Tumour Markers", "Serum", "ng/mL", null, 4.0, "< 4.0 ng/mL (age-dependent)", [0, 10000]),
  ...num("FPSA", "PSA (free)", "Tumour Markers", "Serum", "ng/mL", null, null, "Interpret as free/total ratio", [0, 1000]),
  ...num("AFP", "Alpha-Fetoprotein (AFP)", "Tumour Markers", "Serum", "ng/mL", null, 7.0, "< 7.0 ng/mL (method-dependent)", [0, 1000000]),
  ...num("CEA", "CEA", "Tumour Markers", "Serum", "ng/mL", null, 5.0, "< 5.0 ng/mL", [0, 100000]),
  ...num("CA125", "CA-125", "Tumour Markers", "Serum", "U/mL", null, 35, "< 35 U/mL", [0, 100000]),
  ...num("CA199", "CA 19-9", "Tumour Markers", "Serum", "U/mL", null, 37, "< 37 U/mL", [0, 100000]),
  ...num("CA153", "CA 15-3", "Tumour Markers", "Serum", "U/mL", null, 25, "< 25 U/mL", [0, 100000]),

  // ── Serology and immunology ──────────────────────────────────────────────
  ...serol("HIV", "HIV 1 & 2 antibody (screen)"),
  ...serol("HBSAG", "Hepatitis B surface antigen (HBsAg)"),
  ...serol("HCV", "Hepatitis C antibody"),
  ...serol("HBP_SAG", "HBsAg"),
  ...choice("HBP_SAB", "Anti-HBs", "Serology", "Serum", "Negative (not immune)|Positive (immune)", "Positive after vaccination"),
  ...serol("HBP_EAG", "HBeAg"),
  ...serol("HBP_EAB", "Anti-HBe"),
  ...serol("HBP_CAB", "Anti-HBc (total)"),
  ...serol("VDRL", "VDRL / RPR"),
  ...serol("TPHA", "TPHA"),
  ...choice("WID_TO", "Widal: S. Typhi O", "Serology", "Serum", WIDAL_TITRES, "< 1/160 (single titre; interpret with caution)"),
  ...choice("WID_TH", "Widal: S. Typhi H", "Serology", "Serum", WIDAL_TITRES, "< 1/160"),
  ...choice("WID_AO", "Widal: S. Paratyphi A O", "Serology", "Serum", WIDAL_TITRES, "< 1/160"),
  ...choice("WID_AH", "Widal: S. Paratyphi A H", "Serology", "Serum", WIDAL_TITRES, "< 1/160"),
  ...choice("WID_BO", "Widal: S. Paratyphi B O", "Serology", "Serum", WIDAL_TITRES, "< 1/160"),
  ...choice("WID_BH", "Widal: S. Paratyphi B H", "Serology", "Serum", WIDAL_TITRES, "< 1/160"),
  ...choice("WID_CO", "Widal: S. Paratyphi C O", "Serology", "Serum", WIDAL_TITRES, "< 1/160"),
  ...choice("WID_CH", "Widal: S. Paratyphi C H", "Serology", "Serum", WIDAL_TITRES, "< 1/160"),
  ...qual("UPT", "Pregnancy test (urine hCG)", "Serology", "Urine"),
  ...qual("RF", "Rheumatoid Factor (latex)", "Serology", "Serum"),
  ...num("ASO", "ASO titre", "Serology", "Serum", "IU/mL", null, 200, "< 200 IU/mL", [0, 5000]),
  ...qual("TOXO_G", "Toxoplasma IgG", "Serology", "Serum"), ...qual("TOXO_M", "Toxoplasma IgM", "Serology", "Serum"),
  ...choice("RUB_G", "Rubella IgG", "Serology", "Serum", "Negative (not immune)|Positive (immune)", "Positive means immune"), ...qual("RUB_M", "Rubella IgM", "Serology", "Serum"),
  ...qual("CMV_G", "CMV IgG", "Serology", "Serum"), ...qual("CMV_M", "CMV IgM", "Serology", "Serum"),
  ...qual("CHLAM", "Chlamydia antigen", "Serology", "Endocervical / urethral swab"),
  ...qual("DENGUE", "Dengue NS1 antigen", "Serology", "Serum"),
  ...qual("TYPH_M", "Typhoid IgM (rapid)", "Serology", "Serum"), ...qual("TYPH_G", "Typhoid IgG (rapid)", "Serology", "Serum"),
  ...qual("ANA", "Antinuclear Antibodies (ANA)", "Immunology", "Serum"),
  ...num("CD4", "CD4 count", "Immunology", "EDTA whole blood", "cells/uL", 500, 1500, "500-1500 cells/uL", [0, 5000]),

  // ── Parasitology ─────────────────────────────────────────────────────────
  ...choice("MP", "Malaria parasites (thick & thin film)", "Parasitology", "EDTA whole blood",
    "No malaria parasites seen|P. falciparum + (1-10/100 fields)*|P. falciparum ++ (11-100/100 fields)*|P. falciparum +++ (1-10/field)*|P. falciparum ++++ (> 10/field)*|Other species: see comment*", "No malaria parasites seen", { ref_source: "WHO" }),
  ...text("STOOL_OCP", "Stool microscopy (ova, cysts & parasites)", "Parasitology", "Stool", "No ova, cysts or parasites seen"),
  ...qual("FOBT", "Faecal occult blood (guaiac)", "Parasitology", "Stool"),
  ...choice("SKSNIP", "Skin snip (microfilariae)", "Parasitology", "Skin snip", "No microfilariae seen|Microfilariae seen*", "No microfilariae seen"),
  ...choice("SCHIST", "Urine for Schistosoma ova", "Parasitology", "Terminal urine (midday)", "No S. haematobium ova seen|S. haematobium ova seen*", "No S. haematobium ova seen"),

  // ── Urinalysis ───────────────────────────────────────────────────────────
  ...choice("U_APP", "Urine appearance", "Urinalysis", "Urine", "Clear|Slightly turbid*|Turbid*|Bloody*", "Clear"),
  ...num("U_PH", "Urine pH", "Urinalysis", "Urine", "pH", 4.5, 8.0, "4.5-8.0", [4, 9.5]),
  ...num("U_SG", "Specific gravity", "Urinalysis", "Urine", "", 1.005, 1.03, "1.005-1.030", [1.0, 1.06]),
  ...choice("U_PRO", "Urine protein", "Urinalysis", "Urine", GRADES, "Negative"),
  ...choice("U_GLU", "Urine glucose", "Urinalysis", "Urine", GRADES, "Negative"),
  ...choice("U_KET", "Urine ketones", "Urinalysis", "Urine", GRADES, "Negative"),
  ...choice("U_BLD", "Urine blood", "Urinalysis", "Urine", GRADES, "Negative"),
  ...choice("U_BIL", "Urine bilirubin", "Urinalysis", "Urine", GRADES, "Negative"),
  ...choice("U_URO", "Urobilinogen", "Urinalysis", "Urine", "Normal|1+*|2+*|3+*", "Normal"),
  ...choice("U_NIT", "Nitrite", "Urinalysis", "Urine", "Negative|Positive*", "Negative"),
  ...choice("U_LEU", "Leucocyte esterase", "Urinalysis", "Urine", GRADES, "Negative"),
  ...text("U_MIC", "Urine microscopy", "Urinalysis", "Urine", "Pus cells, red cells, casts, crystals, epithelial cells"),

  // ── Microbiology ─────────────────────────────────────────────────────────
  ...cultureAnalytes,
  ...choice("AFB1", "AFB smear (ZN), sample 1", "Microbiology", "Sputum", "No AFB seen|Scanty AFB*|1+*|2+*|3+*", "No AFB seen", { ref_source: "WHO/IUATLD" }),
  ...choice("AFB2", "AFB smear (ZN), sample 2", "Microbiology", "Sputum", "No AFB seen|Scanty AFB*|1+*|2+*|3+*", "No AFB seen", { ref_source: "WHO/IUATLD" }),
  ...choice("AFB3", "AFB smear (ZN), sample 3", "Microbiology", "Sputum", "No AFB seen|Scanty AFB*|1+*|2+*|3+*", "No AFB seen", { ref_source: "WHO/IUATLD" }),
  ...choice("XPERT", "GeneXpert MTB/RIF", "Microbiology", "Sputum",
    "MTB not detected|MTB detected, RIF resistance not detected*|MTB detected, RIF resistance detected*|MTB detected, RIF indeterminate*|Invalid / error: repeat*", "MTB not detected"),
  ...text("GRAM", "Gram stain", "Microbiology", "As labelled", "Describe cells and organisms seen"),
  ...choice("KOH", "KOH preparation (fungal elements)", "Microbiology", "Skin / nail scraping", "No fungal elements seen|Fungal elements seen*", "No fungal elements seen"),
  ...choice("CSF_APP", "CSF appearance", "Microbiology", "CSF", "Clear|Turbid*|Bloody*|Xanthochromic*", "Clear"),
  ...num("CSF_WBC", "CSF white cell count", "Microbiology", "CSF", "cells/uL", 0, 5, "0-5 cells/uL", [0, 100000]),
  ...num("CSF_GLU", "CSF glucose", "Microbiology", "CSF", "mmol/L", 2.2, 3.9, "2.2-3.9 mmol/L", [0, 30]),
  ...num("CSF_PROT", "CSF protein", "Microbiology", "CSF", "g/L", 0.15, 0.45, "0.15-0.45 g/L", [0, 30]),
  ...text("CSF_GRAM", "CSF Gram stain", "Microbiology", "CSF", "No organisms seen"),

  // ── Molecular ────────────────────────────────────────────────────────────
  ...num("HIVVL", "HIV-1 viral load", "Molecular", "EDTA plasma", "copies/mL", null, 1000, "< 1000 copies/mL: suppressed", [0, 100000000], { ref_source: "WHO" }),
  ...num("HBVDNA", "HBV DNA viral load", "Molecular", "EDTA plasma", "IU/mL", null, null, "Target not detected = below the limit of detection", [0, 10000000000]),
  ...choice("HCVRNA", "HCV RNA", "Molecular", "EDTA plasma", "Not detected|Detected*", "Not detected"),

  // ── Histopathology and cytology ──────────────────────────────────────────
  ...choice("PAP", "Pap smear (Bethesda)", "Histopathology & Cytology", "Cervical smear",
    "NILM (negative)|ASC-US*|LSIL*|ASC-H*|HSIL*|Squamous cell carcinoma*|AGC*|Unsatisfactory: repeat*", "NILM (negative for intraepithelial lesion or malignancy)", { ref_source: "Bethesda 2014" }),
  ...text("PAP_COM", "Pap smear: comment", "Histopathology & Cytology", "Cervical smear", "Optional comment", { optional: 1 }),
  ...text("HISTO", "Histopathology report", "Histopathology & Cytology", "Tissue in formalin", "Macroscopy, microscopy and diagnosis"),
  ...text("FNAC", "Fine-needle aspiration cytology", "Histopathology & Cytology", "Aspirate smears", "Cytology findings and diagnosis"),

  // ── Andrology (WHO 2021 lower reference limits) ─────────────────────────
  ...num("SF_VOL", "Semen volume", "Andrology", "Semen", "mL", 1.4, null, ">= 1.4 mL", [0, 20], { ref_source: "WHO 2021" }),
  ...num("SF_PH", "Semen pH", "Andrology", "Semen", "pH", 7.2, null, ">= 7.2", [5, 10], { ref_source: "WHO 2021" }),
  ...num("SF_CONC", "Sperm concentration", "Andrology", "Semen", "x10^6/mL", 16, null, ">= 16 x10^6/mL", [0, 500], { ref_source: "WHO 2021" }),
  ...num("SF_TOT", "Total sperm number", "Andrology", "Semen", "x10^6", 39, null, ">= 39 x10^6 per ejaculate", [0, 5000], { ref_source: "WHO 2021", calc_formula: "sperm_total" }),
  ...num("SF_MOT", "Total motility (PR + NP)", "Andrology", "Semen", "%", 42, null, ">= 42 %", [0, 100], { ref_source: "WHO 2021" }),
  ...num("SF_PROG", "Progressive motility", "Andrology", "Semen", "%", 30, null, ">= 30 %", [0, 100], { ref_source: "WHO 2021" }),
  ...num("SF_VIT", "Vitality (live spermatozoa)", "Andrology", "Semen", "%", 54, null, ">= 54 %", [0, 100], { ref_source: "WHO 2021" }),
  ...num("SF_MORPH", "Normal forms", "Andrology", "Semen", "%", 4, null, ">= 4 %", [0, 100], { ref_source: "WHO 2021" }),
  ...text("SF_COM", "Semen analysis: comment", "Andrology", "Semen", "Liquefaction, viscosity, agglutination, other cells", { optional: 1 }),
];

const P = (code: string, name: string, department: string, tests: string[], tat_hours: number, price: number, fasting = false): Panel =>
  ({ code, name, department, tests, tat_hours, price, ...(fasting ? { fasting } : {}) });

export const PANELS: Panel[] = [
  // Haematology and blood bank
  P("FBC", "Full blood count", "Haematology", ["HB", "PCV", "RBC", "MCV", "MCH", "MCHC", "WBC", "NEUT", "LYMPH", "MONO", "EOS", "BASO", "PLT"], 2, 7500),
  P("PCV1", "PCV only", "Haematology", ["PCV"], 1, 1500),
  P("ESR", "ESR", "Haematology", ["ESR"], 2, 2000),
  P("RETIC", "Reticulocyte count", "Haematology", ["RETIC"], 4, 3500),
  P("GENO", "Haemoglobin genotype", "Haematology", ["GENO"], 24, 3000),
  P("SICKLE", "Sickling test", "Haematology", ["SICKLE"], 2, 2000),
  P("FILM", "Peripheral blood film", "Haematology", ["FILM"], 24, 5000),
  P("G6PD", "G6PD screen", "Haematology", ["G6PD"], 24, 6000),
  P("COAG", "Clotting profile (PT/INR, APTT)", "Haematology", ["PT", "INR", "APTT"], 4, 15000),
  P("BTCT", "Bleeding and clotting time", "Haematology", ["BT", "CT"], 1, 3000),
  P("DDIMER", "D-dimer", "Haematology", ["DDIMER"], 4, 18000),
  P("FIBR", "Fibrinogen", "Haematology", ["FIBR"], 4, 12000),
  P("BG", "Blood group (ABO/RhD)", "Blood Bank", ["BG"], 1, 2000),
  P("DAT", "Direct Coombs test", "Blood Bank", ["DAT"], 4, 5000),
  P("XM", "Crossmatch (per unit)", "Blood Bank", ["XM"], 2, 5000),
  // Clinical chemistry
  P("FBG", "Fasting blood glucose", "Clinical Chemistry", ["FBG"], 1, 2500, true),
  P("RBG", "Random blood glucose", "Clinical Chemistry", ["RBG"], 1, 2000),
  P("PPG2", "2-hour post-prandial glucose", "Clinical Chemistry", ["PPG2"], 3, 2500),
  P("OGTT", "Oral glucose tolerance test (75 g)", "Clinical Chemistry", ["OGTT0", "OGTT120"], 3, 7500, true),
  P("HBA1C", "HbA1c", "Clinical Chemistry", ["HBA1C"], 4, 12000),
  P("EUCR", "Electrolytes, urea & creatinine (E/U/Cr) + eGFR", "Clinical Chemistry", ["NA", "K", "CL", "HCO3", "UREA", "CREA", "EGFR"], 4, 12000),
  P("LFT", "Liver function tests", "Clinical Chemistry", ["TBIL", "DBIL", "ALT", "AST", "ALP", "GGT", "TP", "ALB", "GLOB"], 4, 15000),
  P("LIPID", "Fasting lipid profile", "Clinical Chemistry", ["TC", "HDL", "TG", "LDL", "TCHDL"], 4, 12000, true),
  P("UA", "Uric acid", "Clinical Chemistry", ["UA"], 4, 3500),
  P("CAPM", "Calcium, phosphate & magnesium", "Clinical Chemistry", ["CA", "PHOS", "MG"], 4, 9000),
  P("PANC", "Amylase & lipase", "Clinical Chemistry", ["AMY", "LIP"], 4, 12000),
  P("CK", "Creatine kinase", "Clinical Chemistry", ["CK"], 4, 8000),
  P("LDH", "LDH", "Clinical Chemistry", ["LDH"], 4, 7000),
  P("TROP", "Troponin I (rapid)", "Clinical Chemistry", ["TROP"], 1, 12000),
  P("IRON", "Iron studies (iron, TIBC, ferritin)", "Clinical Chemistry", ["FE", "TIBC", "FERR"], 24, 25000),
  P("CRP", "CRP", "Clinical Chemistry", ["CRP"], 4, 7000),
  P("HSCRP", "hs-CRP", "Clinical Chemistry", ["HSCRP"], 24, 12000),
  P("UACR", "Urine albumin:creatinine ratio", "Clinical Chemistry", ["UACR"], 24, 10000),
  P("UPROT24", "24-hour urine protein", "Clinical Chemistry", ["UPROT24"], 24, 8000),
  P("VITD", "Vitamin D (25-OH)", "Clinical Chemistry", ["VITD"], 48, 35000),
  P("B12FOL", "Vitamin B12 & folate", "Clinical Chemistry", ["B12", "FOL"], 48, 30000),
  P("INS", "Fasting insulin", "Clinical Chemistry", ["INS"], 48, 18000, true),
  P("FIT", "Faecal immunochemical test", "Clinical Chemistry", ["FIT"], 4, 6000),
  // Endocrinology and tumour markers
  P("TFT", "Thyroid function tests (TSH, FT4, FT3)", "Endocrinology", ["TSH", "FT4", "FT3"], 24, 25000),
  P("TSH", "TSH only", "Endocrinology", ["TSH"], 24, 10000),
  P("FERT", "Female fertility hormones (FSH, LH, prolactin, progesterone, oestradiol)", "Endocrinology", ["FSH", "LH", "PRL", "PROG", "E2"], 48, 45000),
  P("PRL", "Prolactin", "Endocrinology", ["PRL"], 48, 10000),
  P("TESTO", "Testosterone", "Endocrinology", ["TESTO"], 48, 12000),
  P("BHCG", "Beta-hCG (quantitative)", "Endocrinology", ["BHCG"], 24, 12000),
  P("AMH", "Anti-Mullerian hormone", "Endocrinology", ["AMH"], 72, 45000),
  P("CORT", "Cortisol (morning)", "Endocrinology", ["CORT"], 48, 15000),
  P("PSA", "PSA (total)", "Tumour Markers", ["PSA"], 24, 12000),
  P("FPSA", "PSA (total & free)", "Tumour Markers", ["PSA", "FPSA"], 24, 20000),
  P("AFP", "AFP", "Tumour Markers", ["AFP"], 48, 15000),
  P("CEA", "CEA", "Tumour Markers", ["CEA"], 48, 15000),
  P("CA125", "CA-125", "Tumour Markers", ["CA125"], 48, 20000),
  P("CA199", "CA 19-9", "Tumour Markers", ["CA199"], 48, 20000),
  P("CA153", "CA 15-3", "Tumour Markers", ["CA153"], 48, 20000),
  // Serology and immunology
  P("HIV", "HIV 1 & 2 screen", "Serology", ["HIV"], 1, 3000),
  P("HBSAG", "HBsAg", "Serology", ["HBSAG"], 1, 3000),
  P("HCV", "Hepatitis C antibody", "Serology", ["HCV"], 1, 3500),
  P("HBVP", "Hepatitis B profile (5 markers)", "Serology", ["HBP_SAG", "HBP_SAB", "HBP_EAG", "HBP_EAB", "HBP_CAB"], 2, 12000),
  P("VDRL", "VDRL / RPR", "Serology", ["VDRL"], 1, 3000),
  P("TPHA", "TPHA", "Serology", ["TPHA"], 4, 6000),
  P("WIDAL", "Widal test", "Serology", ["WID_TO", "WID_TH", "WID_AO", "WID_AH", "WID_BO", "WID_BH", "WID_CO", "WID_CH"], 2, 3000),
  P("HPYLORI", "H. pylori (stool antigen + serum IgG)", "Serology", ["HPSA", "HPIGG"], 2, 8000),
  P("UPT", "Pregnancy test (urine)", "Serology", ["UPT"], 1, 1500),
  P("RF", "Rheumatoid factor", "Serology", ["RF"], 2, 5000),
  P("ASO", "ASO titre", "Serology", ["ASO"], 4, 6000),
  P("TOXO", "Toxoplasma IgG & IgM", "Serology", ["TOXO_G", "TOXO_M"], 24, 15000),
  P("RUB", "Rubella IgG & IgM", "Serology", ["RUB_G", "RUB_M"], 24, 15000),
  P("CMV", "CMV IgG & IgM", "Serology", ["CMV_G", "CMV_M"], 24, 15000),
  P("CHLAM", "Chlamydia antigen", "Serology", ["CHLAM"], 4, 7000),
  P("DENGUE", "Dengue NS1 antigen", "Serology", ["DENGUE"], 2, 8000),
  P("TYPHI", "Typhoid IgM/IgG (rapid)", "Serology", ["TYPH_M", "TYPH_G"], 2, 5000),
  P("ANA", "ANA", "Immunology", ["ANA"], 48, 15000),
  P("CD4", "CD4 count", "Immunology", ["CD4"], 24, 8000),
  P("MANTOUX", "Tuberculin skin test (Mantoux)", "Immunology", ["MANTOUX"], 72, 5000),
  // Parasitology
  P("MP", "Malaria parasites (thick & thin film)", "Parasitology", ["MP"], 1, 2000),
  P("MAL", "Malaria RDT", "Parasitology", ["MAL"], 1, 2000),
  P("STOOLM", "Stool microscopy (ova, cysts & parasites)", "Parasitology", ["STOOL_OCP"], 4, 3000),
  P("FOBT", "Faecal occult blood (guaiac)", "Parasitology", ["FOBT"], 4, 3500),
  P("SKSNIP", "Skin snip (microfilariae)", "Parasitology", ["SKSNIP"], 24, 4000),
  P("SCHIST", "Urine for Schistosoma ova", "Parasitology", ["SCHIST"], 4, 2500),
  // Urinalysis
  P("URINE", "Urinalysis (dipstick)", "Urinalysis", ["U_APP", "U_PH", "U_SG", "U_PRO", "U_GLU", "U_KET", "U_BLD", "U_BIL", "U_URO", "U_NIT", "U_LEU"], 1, 2500),
  P("URMIC", "Urine microscopy", "Urinalysis", ["U_MIC"], 2, 2000),
  // Microbiology
  ...CULTURES.map(([k, n, , tat]) => P(`${k}MCS`, `${n}: microscopy, culture & sensitivity`, "Microbiology",
    [`${k}_MIC`, `${k}_CUL`, `${k}_ORG`, `${k}_AST`], tat, k === "BLOOD" ? 15000 : 8000)),
  P("AFB", "Sputum AFB (Ziehl-Neelsen) x3", "Microbiology", ["AFB1", "AFB2", "AFB3"], 72, 6000),
  P("XPERT", "GeneXpert MTB/RIF", "Microbiology", ["XPERT"], 24, 15000),
  P("GRAM", "Gram stain", "Microbiology", ["GRAM"], 2, 3000),
  P("KOH", "Skin / nail scraping (KOH)", "Microbiology", ["KOH"], 24, 4000),
  P("CSF", "CSF analysis (cells, glucose, protein, Gram)", "Microbiology", ["CSF_APP", "CSF_WBC", "CSF_GLU", "CSF_PROT", "CSF_GRAM"], 4, 15000),
  // Molecular
  P("HIVVL", "HIV-1 viral load", "Molecular", ["HIVVL"], 168, 40000),
  P("HBVDNA", "HBV DNA viral load", "Molecular", ["HBVDNA"], 168, 60000),
  P("HCVRNA", "HCV RNA", "Molecular", ["HCVRNA"], 168, 60000),
  // Histopathology, cytology, andrology
  P("PAP", "Pap smear", "Histopathology & Cytology", ["PAP", "PAP_COM"], 120, 15000),
  P("HISTOS", "Histology: small biopsy", "Histopathology & Cytology", ["HISTO"], 168, 35000),
  P("HISTOL", "Histology: large specimen", "Histopathology & Cytology", ["HISTO"], 168, 60000),
  P("FNAC", "Fine-needle aspiration cytology", "Histopathology & Cytology", ["FNAC"], 72, 25000),
  P("SFA", "Semen analysis (WHO 2021)", "Andrology", ["SF_VOL", "SF_PH", "SF_CONC", "SF_TOT", "SF_MOT", "SF_PROG", "SF_VIT", "SF_MORPH", "SF_COM"], 4, 10000),
];

export const DEPARTMENTS = [...new Set(PANELS.map((p) => p.department))];

// ── Demo reagent stock (synthetic: suppliers, lots and costs are placeholders) ──
export type ReagentSeed = {
  id: string; name: string; method: string; panels: string[]; tests_per_kit: number; storage: string;
  open_stability_days: number | null; reorder_level_kits: number;
  lots: { lot: string; expiry: string; kits: number; open_left: number; opened_on?: string; cost: number; qa: "accepted" | "quarantine" | "rejected" }[];
};
const MCS = CULTURES.map(([k]) => `${k}MCS`);
export const REAGENTS: ReagentSeed[] = [
  { id: "RG-MRDT", name: "Malaria RDT cassettes (Pf/Pan), 25 tests", method: "Immunochromatography", panels: ["MAL"], tests_per_kit: 25, storage: "2-30 °C", open_stability_days: null, reorder_level_kits: 3,
    lots: [{ lot: "MR2604A", expiry: "2027-03-31", kits: 8, open_left: 14, opened_on: "2026-10-12", cost: 15000, qa: "accepted" }] },
  { id: "RG-GIEMSA", name: "Giemsa stain, 500 mL", method: "Romanowsky stain", panels: ["MP", "FILM"], tests_per_kit: 500, storage: "15-25 °C, dark", open_stability_days: 90, reorder_level_kits: 1,
    lots: [{ lot: "GS2512", expiry: "2027-06-30", kits: 2, open_left: 310, opened_on: "2026-09-01", cost: 18000, qa: "accepted" }] },
  { id: "RG-HIV", name: "HIV 1/2 rapid test, 100 tests", method: "Immunochromatography", panels: ["HIV"], tests_per_kit: 100, storage: "2-30 °C", open_stability_days: null, reorder_level_kits: 2,
    lots: [{ lot: "HV2607", expiry: "2027-01-31", kits: 4, open_left: 62, opened_on: "2026-10-01", cost: 45000, qa: "accepted" }] },
  { id: "RG-HBSAG", name: "HBsAg rapid test, 50 tests", method: "Immunochromatography", panels: ["HBSAG", "HBVP"], tests_per_kit: 50, storage: "2-30 °C", open_stability_days: null, reorder_level_kits: 2,
    lots: [{ lot: "HB2603", expiry: "2026-11-15", kits: 1, open_left: 20, opened_on: "2026-10-05", cost: 15000, qa: "accepted" }, { lot: "HB2610", expiry: "2027-09-30", kits: 4, open_left: 0, cost: 16500, qa: "quarantine" }] },
  { id: "RG-HCV", name: "HCV antibody rapid test, 50 tests", method: "Immunochromatography", panels: ["HCV"], tests_per_kit: 50, storage: "2-30 °C", open_stability_days: null, reorder_level_kits: 1,
    lots: [{ lot: "HC2605", expiry: "2027-02-28", kits: 2, open_left: 33, opened_on: "2026-09-20", cost: 17500, qa: "accepted" }] },
  { id: "RG-RPR", name: "RPR card test, 100 tests", method: "Flocculation", panels: ["VDRL"], tests_per_kit: 100, storage: "2-8 °C", open_stability_days: 90, reorder_level_kits: 1,
    lots: [{ lot: "RP2511", expiry: "2026-12-31", kits: 1, open_left: 47, opened_on: "2026-08-25", cost: 20000, qa: "accepted" }] },
  { id: "RG-WIDAL", name: "Widal antigen set (8 x 5 mL)", method: "Slide / tube agglutination", panels: ["WIDAL"], tests_per_kit: 50, storage: "2-8 °C", open_stability_days: 60, reorder_level_kits: 1,
    lots: [{ lot: "WD2602", expiry: "2026-09-30", kits: 1, open_left: 0, cost: 30000, qa: "accepted" }, { lot: "WD2608", expiry: "2027-08-31", kits: 2, open_left: 28, opened_on: "2026-10-02", cost: 32000, qa: "accepted" }] },
  { id: "RG-UPT", name: "Urine hCG strips, 50 tests", method: "Immunochromatography", panels: ["UPT"], tests_per_kit: 50, storage: "2-30 °C", open_stability_days: null, reorder_level_kits: 1,
    lots: [{ lot: "PT2606", expiry: "2027-05-31", kits: 3, open_left: 18, opened_on: "2026-10-08", cost: 7500, qa: "accepted" }] },
  { id: "RG-HPY", name: "H. pylori stool antigen cassettes, 25 tests", method: "Immunochromatography", panels: ["HPYLORI"], tests_per_kit: 25, storage: "2-30 °C", open_stability_days: null, reorder_level_kits: 1,
    lots: [{ lot: "HP2604", expiry: "2027-03-31", kits: 2, open_left: 11, opened_on: "2026-10-01", cost: 25000, qa: "accepted" }] },
  { id: "RG-FIT", name: "FIT cassettes, 20 tests", method: "Immunochromatography", panels: ["FIT"], tests_per_kit: 20, storage: "2-30 °C", open_stability_days: null, reorder_level_kits: 1,
    lots: [{ lot: "FT2605", expiry: "2027-04-30", kits: 2, open_left: 9, opened_on: "2026-09-28", cost: 30000, qa: "accepted" }] },
  { id: "RG-URS", name: "Urinalysis strips, 10-parameter, 100", method: "Reflectance dipstick", panels: ["URINE"], tests_per_kit: 100, storage: "2-30 °C, capped", open_stability_days: 90, reorder_level_kits: 2,
    lots: [{ lot: "US2607", expiry: "2027-06-30", kits: 5, open_left: 57, opened_on: "2026-09-30", cost: 9000, qa: "accepted" }] },
  { id: "RG-GLU", name: "Glucose (GOD-PAP), 4 x 100 mL", method: "Enzymatic colorimetric", panels: ["FBG", "RBG", "PPG2", "OGTT"], tests_per_kit: 400, storage: "2-8 °C", open_stability_days: 30, reorder_level_kits: 1,
    lots: [{ lot: "GL2606", expiry: "2027-02-28", kits: 3, open_left: 240, opened_on: "2026-10-06", cost: 25000, qa: "accepted" }] },
  { id: "RG-CHOL", name: "Cholesterol (CHOD-PAP), 4 x 100 mL", method: "Enzymatic colorimetric", panels: ["LIPID"], tests_per_kit: 400, storage: "2-8 °C", open_stability_days: 30, reorder_level_kits: 1,
    lots: [{ lot: "CH2605", expiry: "2027-01-31", kits: 2, open_left: 288, opened_on: "2026-10-03", cost: 28000, qa: "accepted" }] },
  { id: "RG-HDL", name: "HDL cholesterol (direct), 160 tests", method: "Homogeneous enzymatic", panels: ["LIPID"], tests_per_kit: 160, storage: "2-8 °C", open_stability_days: 28, reorder_level_kits: 1,
    lots: [{ lot: "HD2604", expiry: "2026-12-31", kits: 2, open_left: 96, opened_on: "2026-10-03", cost: 60000, qa: "accepted" }] },
  { id: "RG-TG", name: "Triglycerides (GPO-PAP), 4 x 100 mL", method: "Enzymatic colorimetric", panels: ["LIPID"], tests_per_kit: 400, storage: "2-8 °C", open_stability_days: 30, reorder_level_kits: 1,
    lots: [{ lot: "TG2605", expiry: "2027-01-31", kits: 2, open_left: 301, opened_on: "2026-10-03", cost: 35000, qa: "accepted" }] },
  { id: "RG-UREA", name: "Urea (urease-GLDH), 4 x 100 mL", method: "Enzymatic UV", panels: ["EUCR"], tests_per_kit: 400, storage: "2-8 °C", open_stability_days: 30, reorder_level_kits: 1,
    lots: [{ lot: "UR2606", expiry: "2027-03-31", kits: 2, open_left: 180, opened_on: "2026-10-04", cost: 26000, qa: "accepted" }] },
  { id: "RG-CREA", name: "Creatinine (Jaffe, IDMS-traceable), 4 x 100 mL", method: "Kinetic Jaffe", panels: ["EUCR"], tests_per_kit: 400, storage: "15-25 °C", open_stability_days: 30, reorder_level_kits: 1,
    lots: [{ lot: "CR2606", expiry: "2027-03-31", kits: 2, open_left: 190, opened_on: "2026-10-04", cost: 22000, qa: "accepted" }] },
  { id: "RG-ISE", name: "Electrolyte (ISE) reagent pack", method: "Ion-selective electrode", panels: ["EUCR"], tests_per_kit: 1000, storage: "15-25 °C", open_stability_days: 60, reorder_level_kits: 1,
    lots: [{ lot: "IS2605", expiry: "2027-04-30", kits: 1, open_left: 620, opened_on: "2026-09-15", cost: 95000, qa: "accepted" }] },
  { id: "RG-LFT", name: "Liver panel reagents (ALT, AST, ALP, bilirubin, protein, albumin)", method: "IFCC / colorimetric", panels: ["LFT"], tests_per_kit: 200, storage: "2-8 °C", open_stability_days: 30, reorder_level_kits: 1,
    lots: [{ lot: "LF2606", expiry: "2027-02-28", kits: 2, open_left: 120, opened_on: "2026-10-01", cost: 85000, qa: "accepted" }] },
  { id: "RG-A1C", name: "HbA1c cartridges, 25 tests", method: "Boronate affinity", panels: ["HBA1C"], tests_per_kit: 25, storage: "2-8 °C", open_stability_days: null, reorder_level_kits: 2,
    lots: [{ lot: "A12607", expiry: "2027-01-31", kits: 3, open_left: 12, opened_on: "2026-10-09", cost: 75000, qa: "accepted" }] },
  { id: "RG-HBE", name: "Haemoglobin electrophoresis kit (alkaline)", method: "Cellulose acetate electrophoresis", panels: ["GENO"], tests_per_kit: 100, storage: "15-25 °C", open_stability_days: null, reorder_level_kits: 1,
    lots: [{ lot: "HE2603", expiry: "2027-03-31", kits: 1, open_left: 44, opened_on: "2026-08-20", cost: 60000, qa: "accepted" }] },
  { id: "RG-ABO", name: "Anti-A, anti-B, anti-D antisera set (3 x 10 mL)", method: "Haemagglutination", panels: ["BG", "XM"], tests_per_kit: 200, storage: "2-8 °C", open_stability_days: null, reorder_level_kits: 1,
    lots: [{ lot: "AB2604", expiry: "2027-02-28", kits: 2, open_left: 140, opened_on: "2026-09-10", cost: 15000, qa: "accepted" }] },
  { id: "RG-HAEM", name: "Haematology analyser reagent pack (diluent, lyse, cleaner)", method: "Impedance / photometric", panels: ["FBC"], tests_per_kit: 1000, storage: "15-30 °C", open_stability_days: 60, reorder_level_kits: 1,
    lots: [{ lot: "HM2607", expiry: "2027-07-31", kits: 2, open_left: 610, opened_on: "2026-09-25", cost: 180000, qa: "accepted" }] },
  { id: "RG-TFT", name: "TSH / FT4 / FT3 ELISA kits, 96 wells", method: "ELISA", panels: ["TFT", "TSH"], tests_per_kit: 96, storage: "2-8 °C", open_stability_days: 30, reorder_level_kits: 1,
    lots: [{ lot: "TF2605", expiry: "2027-01-31", kits: 1, open_left: 40, opened_on: "2026-10-07", cost: 120000, qa: "accepted" }] },
  { id: "RG-PSA", name: "PSA ELISA, 96 wells", method: "ELISA", panels: ["PSA", "FPSA"], tests_per_kit: 96, storage: "2-8 °C", open_stability_days: 30, reorder_level_kits: 1,
    lots: [{ lot: "PS2604", expiry: "2026-12-31", kits: 1, open_left: 58, opened_on: "2026-10-06", cost: 90000, qa: "accepted" }] },
  { id: "RG-PPD", name: "Tuberculin PPD, 1 mL vial (10 tests)", method: "Intradermal (Mantoux)", panels: ["MANTOUX"], tests_per_kit: 10, storage: "2-8 °C, dark", open_stability_days: 30, reorder_level_kits: 2,
    lots: [{ lot: "PD2603", expiry: "2027-03-31", kits: 4, open_left: 6, opened_on: "2026-10-10", cost: 12000, qa: "accepted" }] },
  { id: "RG-XPERT", name: "Xpert MTB/RIF cartridges, 10", method: "Cartridge-based PCR", panels: ["XPERT"], tests_per_kit: 10, storage: "2-28 °C", open_stability_days: null, reorder_level_kits: 2,
    lots: [{ lot: "XP2606", expiry: "2027-05-31", kits: 3, open_left: 4, opened_on: "2026-10-02", cost: 100000, qa: "accepted" }] },
  { id: "RG-PLATES", name: "Culture plates (blood, chocolate, MacConkey, CLED), 100", method: "Culture media", panels: MCS, tests_per_kit: 100, storage: "2-8 °C", open_stability_days: null, reorder_level_kits: 1,
    lots: [{ lot: "CP2610", expiry: "2026-12-15", kits: 2, open_left: 63, opened_on: "2026-10-05", cost: 50000, qa: "accepted" }] },
  { id: "RG-ZN", name: "Ziehl-Neelsen stain kit", method: "Acid-fast stain", panels: ["AFB"], tests_per_kit: 300, storage: "15-25 °C", open_stability_days: null, reorder_level_kits: 1,
    lots: [{ lot: "ZN2602", expiry: "2027-02-28", kits: 1, open_left: 180, opened_on: "2026-07-14", cost: 20000, qa: "accepted" }] },
  { id: "RG-CRP", name: "CRP (turbidimetric), 100 tests", method: "Immunoturbidimetry", panels: ["CRP", "HSCRP"], tests_per_kit: 100, storage: "2-8 °C", open_stability_days: 30, reorder_level_kits: 1,
    lots: [{ lot: "CP2605", expiry: "2027-01-31", kits: 2, open_left: 71, opened_on: "2026-10-04", cost: 40000, qa: "accepted" }] },
];
