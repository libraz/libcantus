#ifndef CANTUS_TOOLS_CLI_EXIT_CODES_H_
#define CANTUS_TOOLS_CLI_EXIT_CODES_H_

/** Process exit codes of the cantus tool; a copy of the CantusStatus table (cantus_c.h). */
enum class ExitCode {
  kOk = 0,
  kInvalidInput = 1,
  kNoSolution = 2,
  kBudgetExceeded = 3,
  kHostTypeError = 4,
  kUnknownOp = 10,
  kBadRequest = 11,
  kInternal = 99
};

#endif  // CANTUS_TOOLS_CLI_EXIT_CODES_H_
