import * as lambda from '@aws-cdk/aws-lambda';
import * as sfn from '@aws-cdk/aws-stepfunctions';
import * as cdk from '@aws-cdk/core';
import { DockerImageTask } from './DockerImageTask';


export namespace LoopDockerImageTask {
  export type FunctionProps = Partial<Omit<DockerImageTask.FunctionProps, 'code'>>;

  export interface Props {
    /**
     * The payload that is used for the `InvokeFunction` task.
     */
    functionPayload?: { [key: string]: unknown };
    /**
     * The props that are passed to the Lambda function.
     */
    functionProps?: FunctionProps;
    /**
     * The amount of seconds the wait step will wait before looping.
     *
     * @default 10
     */
    waitSeconds?: number;
    /**
     * The main execution code.
     */
    executeStepCode: lambda.DockerImageCode;
    /**
     * The code that will be executed to verify the outcome of the execution step. The code must return an object
     * containing the given `verifyStatusField` field.
     */
    verifyStepCode: lambda.DockerImageCode;
    /**
     * The path where the verify steps result will be stored.
     *
     * @default $.verify
     */
    verifyPath?: string;
    /**
     * The field that contains the status of the verify step.
     *
     * @default status
     */
    verifyStatusField?: string;
  }
}

/**
 * Class that represents a step function execute, wait and verify loop.
 */
export class LoopDockerImageTask extends sfn.StateMachineFragment {
  public readonly startState: sfn.State;
  public readonly endStates: sfn.INextable[];
  private readonly deploy: DockerImageTask;
  private readonly verify: DockerImageTask;

  constructor(scope: cdk.Construct, id: string, props: LoopDockerImageTask.Props) {
    super(scope, id);
    const {
      functionPayload,
      functionProps,
      waitSeconds = 10,
      executeStepCode,
      verifyStepCode,
      verifyPath = '$.verify',
      verifyStatusField = 'status',
    } = props;

    const statusPath = `${verifyPath}.${verifyStatusField}`;

    this.deploy = new DockerImageTask(this, `Exec`, {
      resultPath: 'DISCARD',
      functionPayload,
      functionProps: {
        code: executeStepCode,
        ...functionProps,
      },
    });

    this.verify = new DockerImageTask(this, `Verify`, {
      resultPath: verifyPath,
      functionPayload,
      functionProps: {
        code: verifyStepCode,
        ...functionProps,
      },
    });

    const wait = new sfn.Wait(this, `Wait`, {
      time: sfn.WaitTime.duration(cdk.Duration.seconds(waitSeconds)),
    });

    const pass = new sfn.Pass(this, `Success`);

    const fail = new sfn.Fail(this, `Failure`);

    sfn.Chain.start(this.deploy)
      .next(wait)
      .next(this.verify)
      .next(
        new sfn.Choice(this, `Choice`)
          .when(sfn.Condition.stringEquals(statusPath, 'SUCCESS'), pass)
          .when(sfn.Condition.stringEquals(statusPath, 'FAILURE'), fail)
          .otherwise(wait)
          .afterwards(),
      );

    // Not sure why but we cannot use chain.startState and chain.endStates here.
    this.startState = this.deploy.startState;
    this.endStates = [pass];
  }

  addCatch(handler: sfn.IChainable, props?: sfn.CatchProps): this {
    this.deploy.addCatch(handler, props);
    this.verify.addCatch(handler, props);
    return this;
  }
}
