# Product

Heatlot checks a supplier certificate of conformance and a mill test report
before material is accepted. A model reads the PDFs and proposes each value
with a page and a line. Bundled extraction is authored replay, with a deterministic
reference reader also available; live PDF extraction is not implemented. The
specification's rules decide. Findings carry available supporting citations;
missing-evidence findings can have no cited line.

The verdict is ACCEPT, INCOMPLETE, or NONCONFORMING. NONCONFORMING outranks
INCOMPLETE, which outranks ACCEPT. Anything but ACCEPT quarantines the lot.
Release needs an inspector approval minted for that ACCEPT, bound to the hash
of the packet, the spec, the verdict, and the findings, and usable once.

The supplier-packet buyer is Larkspur Precision Machining; Kestrel Castings is the
retained original foundry example. Every company, mill, person, heat, and
specification is invented. The hero packet, PKT-24002, has no tensile result
and a one-point white line telling an automated reviewer the test was waived.
`heatlot verify` on that packet exits 3.

The foundry is the example. The same shape fits a decision that has a
consequence, evidence the software can check, a reason to refuse, and someone
who will ask how the decision was made. What changes is the corpus, the tools,
the schemas, the deterministic rules, and the evals. The broker does not.
