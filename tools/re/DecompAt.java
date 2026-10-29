import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.address.*;
import java.io.*;

// Decompiles the functions at the given addresses, creating them when auto-analysis left them out,
// and writes the C to the file named first. Meant for -readOnly runs: the project is not changed.
//   analyzeHeadless <dir> proj -process MONSTER.EXE -noanalysis -readOnly -postScript DecompAt.java out.c 431960 ...
public class DecompAt extends GhidraScript {
  public void run() throws Exception {
    String[] args = getScriptArgs();
    DecompInterface di = new DecompInterface();
    di.openProgram(currentProgram);
    try (PrintWriter pw = new PrintWriter(new FileWriter(args[0]))) {
      for (int i = 1; i < args.length; i++) {
        Address a = toAddr(Long.parseLong(args[i], 16));
        Function f = getFunctionAt(a);
        if (f == null) { disassemble(a); f = createFunction(a, null); }
        pw.println("// ==== " + args[i]);
        if (f == null) { pw.println("// no function"); continue; }
        DecompileResults r = di.decompileFunction(f, 120, monitor);
        pw.println(r != null && r.decompileCompleted() ? r.getDecompiledFunction().getC() : "// decompile failed");
      }
    }
  }
}
