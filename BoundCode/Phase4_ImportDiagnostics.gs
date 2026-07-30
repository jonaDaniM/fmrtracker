function runPhase4ImportDiagnostics() {
  const installation =
    phase4ImportInstallAdapter();

  const assignedBatches =
    phase4ImportGetAssignedBatches();

  const bootstrap =
    phase4ImportGetBootstrap();

  const result = {
    installation,
    assignedBatches,
    bootstrap
  };

  console.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  return result;
}