import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import ghidra.program.model.address.*;
import ghidra.program.model.mem.*;

// Creates the functions auto-analysis misses: code only reached through tables (MFC message maps,
// vtables, callbacks). First every pointer in the data sections that lands on unclaimed code is
// made a function; then the 16-byte aligned starts left in the gaps between functions are, when
// they follow padding or a return and begin with a plausible first instruction.
public class FindFuncs extends GhidraScript {
  MemoryBlock text;
  Listing listing;

  boolean free(Address a) {
    if (getFunctionContaining(a) != null) return false;
    Instruction in = listing.getInstructionContaining(a);
    if (in != null && !in.getMinAddress().equals(a)) return false;
    return listing.getDefinedDataContaining(a) == null;
  }

  boolean make(Address a) throws Exception {
    if (listing.getInstructionAt(a) == null && !disassemble(a)) return false;
    if (listing.getInstructionAt(a) == null) return false;
    return createFunction(a, null) != null;
  }

  boolean plausible(Address a) throws Exception {
    if (!text.contains(a.subtract(3))) return false;                     // the block's first bytes
    int b = getByte(a) & 0xff, p = getByte(a.subtract(1)) & 0xff;
    long v = getInt(a) & 0xffffffffL;
    if (v >= text.getStart().getOffset() && v <= text.getEnd().getOffset()) return false; // jump table
    if (b < 0x20 && b != 0x0f) return false;                                               // index table
    if (b == 0x90 || b == 0xcc) return false;
    boolean pad = p == 0x90 || p == 0xcc || p == 0xc3 || p == 0x00;      // nop, int3, ret, lea-nop tail
    if (!pad) {
      int p3 = getByte(a.subtract(3)) & 0xff;
      pad = p3 == 0xc2;                                                  // ret n
      Function before = getFunctionContaining(a.subtract(1));
      pad = pad || before != null;
    }
    return pad;
  }

  public void run() throws Exception {
    // MSVC names first; Watcom builds (4x4 Evo 2) use AUTO for code and DGROUP for data.
    text = currentProgram.getMemory().getBlock(".text");
    if (text == null) text = currentProgram.getMemory().getBlock("AUTO");
    listing = currentProgram.getListing();
    long lo = text.getStart().getOffset(), hi = text.getEnd().getOffset();
    int seeds = 0;
    for (String name : new String[] {".rdata", ".data", "DGROUP"}) {
      MemoryBlock blk = currentProgram.getMemory().getBlock(name);
      if (blk == null) continue;
      long n = Math.min(blk.getSize(), currentProgram.getMemory().getBlock(name).getSize());
      for (Address a = blk.getStart(); a.getOffset() + 4 <= blk.getStart().getOffset() + n; a = a.add(4)) {
        if (!blk.isInitialized()) break;
        long v;
        try { v = getInt(a) & 0xffffffffL; } catch (Exception e) { break; }
        if (v < lo || v > hi) continue;
        Address t = toAddr(v);
        int b = getByte(t) & 0xff;
        if (!free(t) || (b < 0x20 && b != 0x0f) || b == 0x90 || b == 0xcc) continue;
        if (make(t)) seeds++;
      }
    }
    println("pointer seeds: " + seeds + " functions");
    analyzeChanges(currentProgram);
    int total = seeds;
    for (int pass = 0; pass < 8; pass++) {
      int made = 0;
      for (Address a = text.getStart(); a.compareTo(text.getEnd()) < 0 && !monitor.isCancelled(); a = a.add(16)) {
        if (!free(a) || !plausible(a)) continue;
        if (make(a)) made++;
      }
      println("pass " + pass + ": " + made + " functions");
      total += made;
      if (made == 0) break;
      analyzeChanges(currentProgram);
    }
    println("created " + total + " functions");
  }
}
